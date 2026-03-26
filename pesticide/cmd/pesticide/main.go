package main

import (
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

var version = "dev"

const runKeyPath = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

type strainDefinition struct {
	Key              string
	Description      string
	ProcessNames     []string
	TaskNames        []string
	ServiceNames     []string
	RunValueNames    []string
	LocalAppDataDirs []string
	AppDataDirs      []string
	ProgramDataDirs  []string
	TempGlobs        []string
}

type hostPaths struct {
	LocalAppData string
	AppData      string
	ProgramData  string
	Temp         string
}

type runningProcess struct {
	PID             int
	Name            string
	Path            string
	CompanyName     string
	FileDescription string
	ProductName     string
	OriginalName    string
	InternalName    string
	Comments        string
}

type processMatch struct {
	PID              int
	Name             string
	Path             string
	Reason           string
	RemoveExecutable bool
}

type inspection struct {
	Scope            []string
	MatchedProcesses []processMatch
	PresentTasks     []string
	PresentServices  []string
	PresentRunValues []string
	PresentPaths     []string
	DynamicPaths     []string
	TempPaths        []string
}

func (i inspection) processHits() int {
	return len(i.MatchedProcesses)
}

func (i inspection) artifactCount() int {
	return i.processHits() +
		len(i.PresentTasks) +
		len(i.PresentServices) +
		len(i.PresentRunValues) +
		len(i.PresentPaths) +
		len(i.DynamicPaths) +
		len(i.TempPaths)
}

func (i inspection) hasArtifacts() bool {
	return i.artifactCount() > 0
}

type cleanupSummary struct {
	Removed []string
	Missing []string
	Failed  []string
}

type taskQuery struct {
	XMLName xml.Name `xml:"Task"`
	Actions struct {
		Exec []struct {
			Command string `xml:"Command"`
		} `xml:"Exec"`
	} `xml:"Actions"`
}

var exePathPattern = regexp.MustCompile(`(?i)"?([A-Z]:\\[^"\r\n]+?\.exe)"?`)

var strainOrder = []string{
	"agent",
	"t1",
	"s1",
	"d1",
	"ds1",
	"se1",
	"e1",
	"a1",
}

var strains = map[string]strainDefinition{
	"agent": {
		Key:           "agent",
		Description:   "Legacy Cordyceps/Jarvis agent",
		ProcessNames:  []string{"cordyceps-agent.exe", "jarvis-agent.exe"},
		TaskNames:     []string{"CordycepsAgent", "CordycepsAgentBoot", "CordycepsAgentWatchdog", "JarvisAgent", "JarvisAgentBoot", "JarvisAgentWatchdog"},
		RunValueNames: []string{"CordycepsAgent", "JarvisAgent"},
		LocalAppDataDirs: []string{
			"CordycepsAgent",
			"JarvisAgent",
		},
		AppDataDirs: []string{
			"CordycepsAgent",
			"JarvisAgent",
		},
		TempGlobs: []string{
			"cordyceps-agent-update-*.exe",
			"cordyceps-agent-update-*.exe.part",
			"cordyceps-agent-updater-*.cmd",
			"agent-launch-*.cmd",
		},
	},
	"t1": {
		Key:           "t1",
		Description:   "T1 agent",
		ProcessNames:  []string{"t1-agent.exe"},
		TaskNames:     []string{"T1Agent", "T1AgentBoot", "T1AgentWatchdog"},
		RunValueNames: []string{"T1Agent"},
		LocalAppDataDirs: []string{
			"T1Agent",
		},
		AppDataDirs: []string{
			"T1Agent",
		},
		TempGlobs: []string{
			"t1-agent-update-*.exe",
			"t1-agent-update-*.exe.part",
			"t1-agent-updater-*.cmd",
			"t1-launch-*.cmd",
		},
	},
	"s1": {
		Key:           "s1",
		Description:   "S1 agent",
		ProcessNames:  []string{"s1-agent.exe"},
		TaskNames:     []string{"S1Agent", "S1AgentBoot", "S1AgentWatchdog"},
		RunValueNames: []string{"S1Agent"},
		LocalAppDataDirs: []string{
			"S1Agent",
		},
		AppDataDirs: []string{
			"S1Agent",
		},
		TempGlobs: []string{
			"s1-agent-update-*.exe",
			"s1-agent-update-*.exe.part",
			"s1-agent-updater-*.cmd",
			"s1-launch-*.cmd",
		},
	},
	"d1": {
		Key:           "d1",
		Description:   "D1 agent",
		ProcessNames:  []string{"d1-agent.exe", "d1-guardian.exe"},
		TaskNames:     []string{"DevHelperBackgroundLogon", "DevHelperBackgroundBoot", "DevHelperBackgroundWatchdog", "D1GuardianLogon", "D1GuardianBoot", "D1GuardianWatchdog", "D1Agent", "D1AgentBoot", "D1AgentWatchdog"},
		ServiceNames:  []string{"CordycepsD1", "CordycepsD1Guardian"},
		RunValueNames: []string{"D1Agent", "D1Guardian"},
		LocalAppDataDirs: []string{
			"D1Agent",
		},
		AppDataDirs: []string{
			"D1Agent",
		},
		ProgramDataDirs: []string{
			"CordycepsD1",
		},
		TempGlobs: []string{
			"d1-agent-update-*.exe",
			"d1-agent-update-*.exe.part",
			"d1-agent-updater-*.cmd",
			"d1-launch-*.cmd",
		},
	},
	"ds1": {
		Key:           "ds1",
		Description:   "DS1 agent",
		ProcessNames:  []string{"ds1-agent.exe"},
		TaskNames:     []string{"DS1AgentLogon", "DS1AgentBoot", "DS1AgentWatchdog", "DS1Agent", "DS1AgentBoot", "DS1AgentWatchdog"},
		ServiceNames:  []string{"CordycepsDS1"},
		RunValueNames: []string{"DS1Agent"},
		LocalAppDataDirs: []string{
			"DS1Agent",
		},
		AppDataDirs: []string{
			"DS1Agent",
		},
		TempGlobs: []string{
			"ds1-launch-*.cmd",
		},
	},
	"se1": {
		Key:           "se1",
		Description:   "SE1 agent",
		ProcessNames:  []string{"se1-agent.exe"},
		TaskNames:     []string{"SE1Agent", "SE1AgentBoot", "SE1AgentWatchdog"},
		RunValueNames: []string{"SE1Agent"},
		LocalAppDataDirs: []string{
			"SE1Agent",
		},
		AppDataDirs: []string{
			"SE1Agent",
		},
		ProgramDataDirs: []string{
			"SE1Agent",
		},
		TempGlobs: []string{
			"se1-agent-update-*.exe",
			"se1-agent-update-*.exe.part",
			"se1-agent-updater-*.cmd",
			"se1-launch-*.cmd",
		},
	},
	"e1": {
		Key:           "e1",
		Description:   "E1 agent",
		ProcessNames:  []string{"e1-agent.exe"},
		TaskNames:     []string{"E1Agent", "E1AgentBoot", "E1AgentWatchdog"},
		RunValueNames: []string{"E1Agent"},
		LocalAppDataDirs: []string{
			"E1Agent",
		},
		AppDataDirs: []string{
			"E1Agent",
		},
		ProgramDataDirs: []string{
			"E1Agent",
		},
		TempGlobs: []string{
			"e1-agent-update-*.exe",
			"e1-agent-update-*.exe.part",
			"e1-agent-updater-*.cmd",
			"e1-launch-*.cmd",
		},
	},
	"a1": {
		Key:           "a1",
		Description:   "A1 agent",
		ProcessNames:  []string{"a1-agent.exe"},
		TaskNames:     []string{"A1Agent", "A1AgentBoot", "A1AgentWatchdog"},
		RunValueNames: []string{"A1Agent"},
		LocalAppDataDirs: []string{
			"A1Agent",
		},
		AppDataDirs: []string{
			"A1Agent",
		},
		TempGlobs: []string{
			"a1-agent-update-*.exe",
			"a1-agent-update-*.exe.part",
			"a1-agent-updater-*.cmd",
			"a1-launch-*.cmd",
		},
	},
}

func main() {
	if runtime.GOOS == "windows" && len(os.Args) == 1 {
		runInteractiveApp()
		return
	}

	modeFlag := flag.String("mode", "clean", "Mode: inspect or clean")
	scopeFlag := flag.String("scope", "all", fmt.Sprintf("Scope: all or comma-separated strain keys (%s)", supportedScopeLabel()))
	dryRunFlag := flag.Bool("dry-run", false, "Show what clean would remove without making changes")
	versionFlag := flag.Bool("version", false, "Print version and exit")
	flag.Parse()

	if *versionFlag {
		fmt.Println(version)
		return
	}

	if runtime.GOOS != "windows" {
		fmt.Fprintln(os.Stderr, "cordyceps-pesticide is intended to run on Windows")
		os.Exit(2)
	}

	mode := strings.ToLower(strings.TrimSpace(*modeFlag))
	if mode != "inspect" && mode != "clean" {
		fmt.Fprintf(os.Stderr, "unsupported mode %q\n", *modeFlag)
		os.Exit(2)
	}

	scope, err := resolveScope(*scopeFlag)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	host := detectHostPaths()
	report := inspectHost(scope, host)
	printInspection(mode, *dryRunFlag, report)

	if mode == "inspect" {
		return
	}

	if !report.hasArtifacts() {
		fmt.Println()
		fmt.Println("No matching Cordyceps/Jarvis artifacts were found. Nothing was removed.")
		return
	}

	summary := cleanHost(report, *dryRunFlag)
	printCleanupSummary(summary, *dryRunFlag)

	if len(summary.Failed) > 0 {
		os.Exit(1)
	}
}

func runInteractiveApp() {
	scope := append([]string(nil), strainOrder...)
	host := detectHostPaths()
	report := inspectHost(scope, host)

	if !report.hasArtifacts() {
		showInfoDialog("Cordyceps Pesticide", "No known Cordyceps/Jarvis agent artifacts were found on this device.")
		return
	}

	if !showConfirmDialog("Cordyceps Pesticide", interactiveInspectionMessage(report)) {
		return
	}

	summary := cleanHost(report, false)
	if len(summary.Failed) > 0 {
		showErrorDialog("Cordyceps Pesticide", interactiveCleanupMessage(summary, true))
		os.Exit(1)
	}

	showInfoDialog("Cordyceps Pesticide", interactiveCleanupMessage(summary, false))
}

func supportedScopeLabel() string {
	return "all," + strings.Join(strainOrder, ",")
}

func resolveScope(raw string) ([]string, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" || trimmed == "all" {
		return append([]string(nil), strainOrder...), nil
	}

	items := strings.Split(trimmed, ",")
	seen := map[string]bool{}
	scope := make([]string, 0, len(items))
	for _, item := range items {
		key := strings.TrimSpace(item)
		if key == "" {
			continue
		}
		if _, ok := strains[key]; !ok {
			return nil, fmt.Errorf("unknown scope %q", key)
		}
		if !seen[key] {
			scope = append(scope, key)
			seen[key] = true
		}
	}
	if len(scope) == 0 {
		return nil, errors.New("scope is empty after parsing")
	}
	sort.Slice(scope, func(i, j int) bool {
		return orderIndex(scope[i]) < orderIndex(scope[j])
	})
	return scope, nil
}

func orderIndex(key string) int {
	for i, candidate := range strainOrder {
		if candidate == key {
			return i
		}
	}
	return len(strainOrder)
}

func detectHostPaths() hostPaths {
	return hostPaths{
		LocalAppData: strings.TrimSpace(os.Getenv("LOCALAPPDATA")),
		AppData:      strings.TrimSpace(os.Getenv("APPDATA")),
		ProgramData:  strings.TrimSpace(os.Getenv("PROGRAMDATA")),
		Temp:         strings.TrimSpace(os.TempDir()),
	}
}

func inspectHost(scope []string, host hostPaths) inspection {
	processes, processErr := listProcesses()
	if processErr != nil {
		fmt.Fprintf(os.Stderr, "warning: enumerate processes: %v\n", processErr)
		processes = nil
	}

	presentTasks := make([]string, 0)
	presentServices := make([]string, 0)
	presentRunValues := make([]string, 0)
	presentPathsSet := map[string]bool{}
	dynamicPathsSet := map[string]bool{}
	tempPathsSet := map[string]bool{}
	knownProcessNamesSet := map[string]bool{}
	knownInternalNamesSet := map[string]bool{}
	knownRootPathsSet := map[string]bool{}
	exactExecutablePathsSet := map[string]bool{}

	for _, key := range scope {
		def := strains[key]
		for _, processName := range def.ProcessNames {
			knownProcessNamesSet[strings.ToLower(processName)] = true
			knownInternalNamesSet[strings.ToLower(strings.TrimSuffix(processName, ".exe"))] = true
		}

		for _, taskName := range def.TaskNames {
			if taskExists(taskName) {
				presentTasks = append(presentTasks, taskName)
			}
			for _, candidate := range discoverTaskExecutablePaths(taskName) {
				addNormalizedPath(dynamicPathsSet, candidate)
				addNormalizedPath(exactExecutablePathsSet, candidate)
			}
		}

		for _, serviceName := range def.ServiceNames {
			if serviceExists(serviceName) {
				presentServices = append(presentServices, serviceName)
			}
			for _, candidate := range discoverServiceExecutablePaths(serviceName) {
				addNormalizedPath(dynamicPathsSet, candidate)
				addNormalizedPath(exactExecutablePathsSet, candidate)
			}
		}

		for _, runValue := range def.RunValueNames {
			if runValueExists(runValue) {
				presentRunValues = append(presentRunValues, runValue)
			}
			for _, candidate := range discoverRunValueExecutablePaths(runValue) {
				addNormalizedPath(dynamicPathsSet, candidate)
				addNormalizedPath(exactExecutablePathsSet, candidate)
			}
		}

		for _, candidate := range collectKnownPaths(def, host) {
			addNormalizedPath(knownRootPathsSet, candidate)
			if pathExists(candidate) {
				addNormalizedPath(presentPathsSet, candidate)
			}
		}

		for _, candidate := range expandTempGlobs(def, host.Temp) {
			addNormalizedPath(tempPathsSet, candidate)
		}
	}

	selfPath := ""
	if executablePath, err := os.Executable(); err == nil {
		selfPath = normalizePath(executablePath)
	}

	matchedProcesses := matchProcesses(
		processes,
		sortedKeys(knownProcessNamesSet),
		sortedKeys(knownInternalNamesSet),
		sortedKeys(knownRootPathsSet),
		sortedKeys(exactExecutablePathsSet),
		os.Getpid(),
		selfPath,
	)
	for _, process := range matchedProcesses {
		if process.RemoveExecutable {
			addNormalizedPath(dynamicPathsSet, process.Path)
		}
	}

	return inspection{
		Scope:            scope,
		MatchedProcesses: matchedProcesses,
		PresentTasks:     uniqueSorted(presentTasks),
		PresentServices:  uniqueSorted(presentServices),
		PresentRunValues: uniqueSorted(presentRunValues),
		PresentPaths:     sortedKeys(presentPathsSet),
		DynamicPaths:     sortedKeys(dynamicPathsSet),
		TempPaths:        sortedKeys(tempPathsSet),
	}
}

func cleanHost(report inspection, dryRun bool) cleanupSummary {
	summary := cleanupSummary{
		Removed: make([]string, 0),
		Missing: make([]string, 0),
		Failed:  make([]string, 0),
	}

	record := func(ok bool, missing bool, message string, err error) {
		switch {
		case err != nil:
			summary.Failed = append(summary.Failed, fmt.Sprintf("%s: %v", message, err))
		case missing:
			summary.Missing = append(summary.Missing, message)
		case ok:
			summary.Removed = append(summary.Removed, message)
		}
	}

	taskNames := make([]string, 0)
	serviceNames := make([]string, 0)
	runValues := make([]string, 0)
	for _, key := range report.Scope {
		def := strains[key]
		taskNames = append(taskNames, def.TaskNames...)
		serviceNames = append(serviceNames, def.ServiceNames...)
		runValues = append(runValues, def.RunValueNames...)
	}
	taskNames = uniqueSorted(taskNames)
	serviceNames = uniqueSorted(serviceNames)
	runValues = uniqueSorted(runValues)

	for _, taskName := range taskNames {
		ok, missing, err := deleteScheduledTask(taskName, dryRun)
		record(ok, missing, "task "+taskName, err)
	}

	for _, serviceName := range serviceNames {
		ok, missing, err := deleteService(serviceName, dryRun)
		record(ok, missing, "service "+serviceName, err)
	}

	for _, runValue := range runValues {
		ok, missing, err := deleteRunValue(runValue, dryRun)
		record(ok, missing, "run key "+runValue, err)
	}

	for _, process := range report.MatchedProcesses {
		ok, missing, err := killProcess(process, dryRun)
		record(ok, missing, describeProcess(process), err)
	}

	for _, candidate := range uniqueSorted(append(report.DynamicPaths, report.PresentPaths...)) {
		ok, missing, err := removePath(candidate, dryRun)
		record(ok, missing, "path "+candidate, err)

		if strings.HasSuffix(strings.ToLower(candidate), ".exe") {
			backupPath := candidate + ".bak"
			ok, missing, err = removePath(backupPath, dryRun)
			record(ok, missing, "path "+backupPath, err)
		}
	}

	for _, candidate := range report.TempPaths {
		ok, missing, err := removePath(candidate, dryRun)
		record(ok, missing, "temp "+candidate, err)
	}

	return summary
}

func listProcesses() ([]runningProcess, error) {
	script := "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | ForEach-Object { " +
		"$path = $_.ExecutablePath; " +
		"$version = $null; " +
		"if ($path -and (Test-Path -LiteralPath $path)) { try { $version = (Get-Item -LiteralPath $path).VersionInfo } catch {} }; " +
		"[pscustomobject]@{ " +
		"ProcessId = $_.ProcessId; " +
		"Name = $_.Name; " +
		"ExecutablePath = $path; " +
		"CompanyName = if ($version) { $version.CompanyName } else { '' }; " +
		"FileDescription = if ($version) { $version.FileDescription } else { '' }; " +
		"ProductName = if ($version) { $version.ProductName } else { '' }; " +
		"OriginalFilename = if ($version) { $version.OriginalFilename } else { '' }; " +
		"InternalName = if ($version) { $version.InternalName } else { '' }; " +
		"Comments = if ($version) { $version.Comments } else { '' } " +
		"} } | ConvertTo-Csv -NoTypeInformation"
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	records, err := csv.NewReader(bytes.NewReader(output)).ReadAll()
	if err != nil {
		return nil, err
	}

	processes := make([]runningProcess, 0, len(records))
	for index, record := range records {
		if index == 0 || len(record) < 8 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(record[0]))
		if err != nil {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(record[1]))
		if name == "" {
			continue
		}
		processes = append(processes, runningProcess{
			PID:             pid,
			Name:            name,
			Path:            normalizePath(record[2]),
			CompanyName:     strings.TrimSpace(record[3]),
			FileDescription: strings.TrimSpace(record[4]),
			ProductName:     strings.TrimSpace(record[5]),
			OriginalName:    strings.TrimSpace(record[6]),
			InternalName:    strings.TrimSpace(record[7]),
			Comments: func() string {
				if len(record) > 8 {
					return strings.TrimSpace(record[8])
				}
				return ""
			}(),
		})
	}
	sort.Slice(processes, func(i, j int) bool {
		if processes[i].Name == processes[j].Name {
			return processes[i].PID < processes[j].PID
		}
		return processes[i].Name < processes[j].Name
	})
	return processes, nil
}

func taskExists(taskName string) bool {
	cmd := exec.Command("schtasks", "/Query", "/TN", taskName)
	return cmd.Run() == nil
}

func runValueExists(valueName string) bool {
	cmd := exec.Command("reg", "query", runKeyPath, "/v", valueName)
	return cmd.Run() == nil
}

func discoverTaskExecutablePaths(taskName string) []string {
	cmd := exec.Command("schtasks", "/Query", "/TN", taskName, "/XML")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}

	var definition taskQuery
	if err := xml.Unmarshal(output, &definition); err != nil {
		return nil
	}

	paths := make([]string, 0, len(definition.Actions.Exec))
	for _, action := range definition.Actions.Exec {
		addIfExecutablePath(&paths, action.Command)
	}
	return uniqueSorted(paths)
}

func serviceExists(serviceName string) bool {
	cmd := exec.Command("sc.exe", "query", serviceName)
	return cmd.Run() == nil
}

func discoverServiceExecutablePaths(serviceName string) []string {
	cmd := exec.Command("sc.exe", "qc", serviceName)
	output, err := cmd.Output()
	if err != nil {
		return nil
	}

	match := exePathPattern.FindStringSubmatch(string(output))
	if len(match) < 2 {
		return nil
	}

	return []string{filepath.Clean(match[1])}
}

func discoverRunValueExecutablePaths(valueName string) []string {
	cmd := exec.Command("reg", "query", runKeyPath, "/v", valueName)
	output, err := cmd.Output()
	if err != nil {
		return nil
	}

	match := exePathPattern.FindStringSubmatch(string(output))
	if len(match) < 2 {
		return nil
	}

	return []string{filepath.Clean(match[1])}
}

func collectKnownPaths(def strainDefinition, host hostPaths) []string {
	paths := make([]string, 0, len(def.LocalAppDataDirs)+len(def.AppDataDirs)+len(def.ProgramDataDirs))

	if host.LocalAppData != "" {
		for _, item := range def.LocalAppDataDirs {
			paths = append(paths, filepath.Join(host.LocalAppData, item))
		}
	}

	if host.AppData != "" {
		for _, item := range def.AppDataDirs {
			paths = append(paths, filepath.Join(host.AppData, item))
		}
	}

	if host.ProgramData != "" {
		for _, item := range def.ProgramDataDirs {
			paths = append(paths, filepath.Join(host.ProgramData, item))
		}
	}

	return uniqueSorted(paths)
}

func expandTempGlobs(def strainDefinition, tempRoot string) []string {
	if strings.TrimSpace(tempRoot) == "" {
		return nil
	}

	paths := make([]string, 0)
	for _, pattern := range def.TempGlobs {
		matches, err := filepath.Glob(filepath.Join(tempRoot, pattern))
		if err != nil {
			continue
		}
		for _, match := range matches {
			addNormalizedPathSlice(&paths, match)
		}
	}
	return uniqueSorted(paths)
}

func deleteScheduledTask(taskName string, dryRun bool) (bool, bool, error) {
	if !taskExists(taskName) {
		return false, true, nil
	}
	if dryRun {
		return true, false, nil
	}
	cmd := exec.Command("schtasks", "/Delete", "/TN", taskName, "/F")
	if output, err := cmd.CombinedOutput(); err != nil {
		return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return true, false, nil
}

func deleteService(serviceName string, dryRun bool) (bool, bool, error) {
	if !serviceExists(serviceName) {
		return false, true, nil
	}
	if dryRun {
		return true, false, nil
	}

	if output, err := exec.Command("sc.exe", "stop", serviceName).CombinedOutput(); err != nil {
		lower := strings.ToLower(string(output))
		if !strings.Contains(lower, "service has not been started") &&
			!strings.Contains(lower, "service not active") &&
			!strings.Contains(lower, "service cannot accept control messages at this time") {
			return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
		}
	}

	cmd := exec.Command("sc.exe", "delete", serviceName)
	if output, err := cmd.CombinedOutput(); err != nil {
		return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}

	return true, false, nil
}

func deleteRunValue(valueName string, dryRun bool) (bool, bool, error) {
	if !runValueExists(valueName) {
		return false, true, nil
	}
	if dryRun {
		return true, false, nil
	}
	cmd := exec.Command("reg", "delete", runKeyPath, "/v", valueName, "/f")
	if output, err := cmd.CombinedOutput(); err != nil {
		return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return true, false, nil
}

func killProcess(process processMatch, dryRun bool) (bool, bool, error) {
	if !processRunning(process.PID) {
		return false, true, nil
	}
	if dryRun {
		return true, false, nil
	}
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(process.PID))
	if output, err := cmd.CombinedOutput(); err != nil {
		return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return true, false, nil
}

func processRunning(pid int) bool {
	cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH", "/FO", "CSV")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return !strings.Contains(strings.ToLower(string(output)), "no tasks are running")
}

func removePath(target string, dryRun bool) (bool, bool, error) {
	cleaned := filepath.Clean(strings.TrimSpace(target))
	if cleaned == "" {
		return false, true, nil
	}

	info, err := os.Lstat(cleaned)
	if err != nil {
		if os.IsNotExist(err) {
			return false, true, nil
		}
		return false, false, err
	}

	if dryRun {
		return true, false, nil
	}

	if info.IsDir() {
		if err := os.RemoveAll(cleaned); err != nil {
			return false, false, err
		}
	} else {
		if err := os.Remove(cleaned); err != nil {
			return false, false, err
		}
	}

	if pathExists(cleaned) {
		time.Sleep(250 * time.Millisecond)
		if info.IsDir() {
			if err := os.RemoveAll(cleaned); err != nil && pathExists(cleaned) {
				return false, false, err
			}
		} else {
			if err := os.Remove(cleaned); err != nil && pathExists(cleaned) {
				return false, false, err
			}
		}
	}

	return true, false, nil
}

func pathExists(target string) bool {
	if strings.TrimSpace(target) == "" {
		return false
	}
	_, err := os.Lstat(target)
	return err == nil
}

func addNormalizedPath(set map[string]bool, candidate string) {
	cleaned := normalizePath(candidate)
	if cleaned == "" {
		return
	}
	set[cleaned] = true
}

func addNormalizedPathSlice(paths *[]string, candidate string) {
	cleaned := normalizePath(candidate)
	if cleaned == "" {
		return
	}
	*paths = append(*paths, cleaned)
}

func addIfExecutablePath(paths *[]string, candidate string) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return
	}
	match := exePathPattern.FindStringSubmatch(candidate)
	if len(match) >= 2 {
		*paths = append(*paths, filepath.Clean(match[1]))
		return
	}
	lower := strings.ToLower(candidate)
	if strings.HasSuffix(lower, ".exe") {
		*paths = append(*paths, filepath.Clean(candidate))
	}
}

func uniqueSorted(items []string) []string {
	set := make(map[string]bool, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		set[trimmed] = true
	}
	return sortedKeys(set)
}

func sortedKeys(set map[string]bool) []string {
	items := make([]string, 0, len(set))
	for item := range set {
		items = append(items, item)
	}
	sort.Strings(items)
	return items
}

func matchProcesses(processes []runningProcess, knownNames []string, knownInternalNames []string, knownRoots []string, exactPaths []string, selfPID int, selfPath string) []processMatch {
	if len(processes) == 0 {
		return nil
	}

	nameSet := make(map[string]bool, len(knownNames))
	for _, name := range knownNames {
		normalized := strings.ToLower(strings.TrimSpace(name))
		if normalized != "" {
			nameSet[normalized] = true
		}
	}

	internalNameSet := make(map[string]bool, len(knownInternalNames))
	for _, name := range knownInternalNames {
		normalized := strings.ToLower(strings.TrimSpace(name))
		if normalized != "" {
			internalNameSet[normalized] = true
		}
	}

	exactPathSet := make(map[string]bool, len(exactPaths))
	for _, path := range exactPaths {
		normalized := normalizePath(path)
		if normalized != "" {
			exactPathSet[strings.ToLower(normalized)] = true
		}
	}

	selfPath = strings.ToLower(normalizePath(selfPath))
	normalizedRoots := make([]string, 0, len(knownRoots))
	for _, root := range knownRoots {
		normalized := normalizePath(root)
		if normalized != "" {
			normalizedRoots = append(normalizedRoots, strings.ToLower(normalized))
		}
	}

	matches := make([]processMatch, 0)
	for _, process := range processes {
		if process.PID == selfPID {
			continue
		}
		if selfPath != "" && strings.EqualFold(process.Path, selfPath) {
			continue
		}

		reason := ""
		removeExecutable := false
		if process.Path != "" {
			lowerPath := strings.ToLower(process.Path)
			if exactPathSet[lowerPath] {
				reason = "discovered executable path"
				removeExecutable = true
			} else if matchesKnownAgentMetadata(process, internalNameSet) {
				reason = "embedded metadata"
				removeExecutable = true
			} else if pathWithinAnyRoot(lowerPath, normalizedRoots) {
				reason = "known install/data root"
				removeExecutable = true
			}
		}
		if reason == "" && nameSet[strings.ToLower(strings.TrimSpace(process.Name))] {
			reason = "name"
			removeExecutable = false
		}

		if reason == "" && matchesKnownAgentMetadata(process, internalNameSet) {
			reason = "embedded metadata"
			removeExecutable = true
		}

		if reason == "" {
			continue
		}

		if removeExecutable && process.Path == "" {
			removeExecutable = false
		}

		matches = append(matches, processMatch{
			PID:              process.PID,
			Name:             process.Name,
			Path:             process.Path,
			Reason:           reason,
			RemoveExecutable: removeExecutable,
		})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Name == matches[j].Name {
			if matches[i].Path == matches[j].Path {
				return matches[i].PID < matches[j].PID
			}
			return matches[i].Path < matches[j].Path
		}
		return matches[i].Name < matches[j].Name
	})

	return matches
}

func matchesKnownAgentMetadata(process runningProcess, internalNameSet map[string]bool) bool {
	internalName := strings.ToLower(strings.TrimSpace(process.InternalName))
	if internalName != "" && internalNameSet[internalName] {
		return true
	}

	comments := strings.ToLower(strings.TrimSpace(process.Comments))
	if comments != "cordyceps windows agent" {
		return false
	}

	combined := strings.ToLower(strings.Join([]string{
		process.ProductName,
		process.FileDescription,
		process.InternalName,
		process.OriginalName,
	}, " "))

	if strings.Contains(combined, "pesticide") {
		return false
	}

	hasFamilyMarker := strings.Contains(combined, "cordyceps") || strings.Contains(combined, "jarvis")
	hasRoleMarker := strings.Contains(combined, "agent") || strings.Contains(combined, "guardian") || strings.Contains(combined, "watchdog")
	return hasFamilyMarker && hasRoleMarker
}

func pathWithinAnyRoot(lowerPath string, lowerRoots []string) bool {
	for _, lowerRoot := range lowerRoots {
		if lowerPath == lowerRoot || strings.HasPrefix(lowerPath, lowerRoot+`\`) {
			return true
		}
	}
	return false
}

func normalizePath(candidate string) string {
	cleaned := strings.TrimSpace(candidate)
	if cleaned == "" {
		return ""
	}
	return filepath.Clean(cleaned)
}

func describeProcess(process processMatch) string {
	message := fmt.Sprintf("process pid %d (%s)", process.PID, process.Name)
	if process.Path != "" {
		message += " " + process.Path
	}
	if process.Reason != "" {
		message += " [" + process.Reason + "]"
	}
	return message
}

func printInspection(mode string, dryRun bool, report inspection) {
	fmt.Printf("Cordyceps Pesticide %s\n", version)
	fmt.Printf("Mode: %s", mode)
	if dryRun && mode == "clean" {
		fmt.Print(" (dry-run)")
	}
	fmt.Println()
	fmt.Printf("Scope: %s\n", strings.Join(report.Scope, ", "))
	fmt.Println()

	fmt.Println("Process hits:")
	if len(report.MatchedProcesses) == 0 {
		fmt.Println("  - none")
	} else {
		for _, process := range report.MatchedProcesses {
			fmt.Printf("  - pid %d %s", process.PID, process.Name)
			if process.Path != "" {
				fmt.Printf(" -> %s", process.Path)
			}
			if process.Reason != "" {
				fmt.Printf(" [%s]", process.Reason)
			}
			fmt.Println()
		}
	}

	fmt.Println("Scheduled tasks:")
	printStringList(report.PresentTasks)

	fmt.Println("Windows services:")
	printStringList(report.PresentServices)

	fmt.Println("Run keys:")
	printStringList(report.PresentRunValues)

	fmt.Println("Known paths:")
	printStringList(report.PresentPaths)

	fmt.Println("Discovered executable paths:")
	printStringList(report.DynamicPaths)

	fmt.Println("Temp leftovers:")
	printStringList(report.TempPaths)
}

func printCleanupSummary(summary cleanupSummary, dryRun bool) {
	fmt.Println()
	if dryRun {
		fmt.Println("Dry-run summary:")
	} else {
		fmt.Println("Cleanup summary:")
	}

	fmt.Println("Removed or queued:")
	printStringList(summary.Removed)

	fmt.Println("Already absent:")
	printStringList(summary.Missing)

	if len(summary.Failed) > 0 {
		fmt.Println("Failed:")
		printStringList(summary.Failed)
	}
}

func printStringList(items []string) {
	if len(items) == 0 {
		fmt.Println("  - none")
		return
	}
	for _, item := range items {
		fmt.Printf("  - %s\n", item)
	}
}

func interactiveInspectionMessage(report inspection) string {
	lines := []string{
		"Known Cordyceps/Jarvis artifacts were found on this device.",
		"",
		fmt.Sprintf("Processes: %d", report.processHits()),
		fmt.Sprintf("Scheduled tasks: %d", len(report.PresentTasks)),
		fmt.Sprintf("Windows services: %d", len(report.PresentServices)),
		fmt.Sprintf("Run keys: %d", len(report.PresentRunValues)),
		fmt.Sprintf("Known install/data paths: %d", len(report.PresentPaths)),
		fmt.Sprintf("Discovered executable paths: %d", len(report.DynamicPaths)),
		fmt.Sprintf("Temp leftovers: %d", len(report.TempPaths)),
		"",
		"This will stop the known agent processes and remove their known persistence and data paths.",
		"",
		"Do you want to clean this device now?",
	}

	return strings.Join(lines, "\n")
}

func interactiveCleanupMessage(summary cleanupSummary, failed bool) string {
	lines := []string{
		fmt.Sprintf("Removed: %d", len(summary.Removed)),
		fmt.Sprintf("Already absent: %d", len(summary.Missing)),
		fmt.Sprintf("Failed: %d", len(summary.Failed)),
	}

	if failed {
		lines = append(lines, "", "The first failure was:", firstItem(summary.Failed))
	} else if len(summary.Removed) > 0 {
		lines = append(lines, "", "The first removed item was:", firstItem(summary.Removed))
	}

	return strings.Join(lines, "\n")
}

func firstItem(items []string) string {
	if len(items) == 0 {
		return "none"
	}
	return items[0]
}
