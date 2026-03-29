package main

import (
	"bytes"
	"context"
	"encoding/json"
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
	"sync"
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

type processRecord struct {
	ProcessID       int    `json:"ProcessId"`
	Name            string `json:"Name"`
	ExecutablePath  string `json:"ExecutablePath"`
	CompanyName     string `json:"CompanyName"`
	FileDescription string `json:"FileDescription"`
	ProductName     string `json:"ProductName"`
	OriginalName    string `json:"OriginalFilename"`
	InternalName    string `json:"InternalName"`
	Comments        string `json:"Comments"`
}

type taskSnapshotRecord struct {
	Name     string   `json:"Name"`
	Commands []string `json:"Commands"`
}

type serviceSnapshotRecord struct {
	Name     string `json:"Name"`
	PathName string `json:"PathName"`
}

type runValueSnapshotRecord struct {
	Name    string `json:"Name"`
	Command string `json:"Command"`
}

type inspectionTargets struct {
	ProcessNames   []string
	InternalNames  []string
	KnownRootPaths []string
	TaskNames      []string
	ServiceNames   []string
	RunValueNames  []string
	TempGlobs      []string
}

var exePathPattern = regexp.MustCompile(`(?i)"?([A-Z]:\\[^"\r\n]+?\.exe)"?`)

const externalCommandTimeout = 20 * time.Second

func d1ProcessNames(roleCount int) []string {
	values := []string{"d1-agent.exe", "d1-guardian.exe", "d1-heartbeat.exe"}
	for role := 1; role <= roleCount; role++ {
		values = append(values, fmt.Sprintf("d1-drone-%d.exe", role))
	}
	return values
}

func d1TaskNames(roleCount int) []string {
	values := []string{
		"DevHelperBackgroundLogon",
		"DevHelperBackgroundBoot",
		"DevHelperBackgroundWatchdog",
		"D1GuardianLogon",
		"D1GuardianBoot",
		"D1GuardianWatchdog",
		"D1Agent",
		"D1AgentBoot",
		"D1AgentWatchdog",
	}
	for role := 1; role <= roleCount; role++ {
		values = append(values,
			fmt.Sprintf("D1Drone%dLogon", role),
			fmt.Sprintf("D1Drone%dBoot", role),
			fmt.Sprintf("D1Drone%dWatchdog", role),
		)
	}
	return values
}

func d1RunValueNames(roleCount int) []string {
	values := []string{"D1Agent", "D1Guardian", "D1Heartbeat"}
	for role := 1; role <= roleCount; role++ {
		values = append(values, fmt.Sprintf("D1Drone%d", role))
	}
	return values
}

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
		ProcessNames:  d1ProcessNames(16),
		TaskNames:     d1TaskNames(16),
		ServiceNames:  []string{"CordycepsD1", "CordycepsD1Guardian"},
		RunValueNames: d1RunValueNames(16),
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

func buildInspectionTargets(scope []string, host hostPaths) inspectionTargets {
	processNameSet := map[string]bool{}
	internalNameSet := map[string]bool{}
	knownRootPathsSet := map[string]bool{}
	taskNameSet := map[string]bool{}
	serviceNameSet := map[string]bool{}
	runValueSet := map[string]bool{}
	tempGlobsSet := map[string]bool{}

	for _, key := range scope {
		def := strains[key]
		for _, processName := range def.ProcessNames {
			normalized := strings.ToLower(strings.TrimSpace(processName))
			if normalized == "" {
				continue
			}
			processNameSet[normalized] = true
			internalNameSet[strings.TrimSuffix(normalized, ".exe")] = true
		}
		for _, taskName := range def.TaskNames {
			taskName = strings.TrimSpace(taskName)
			if taskName != "" {
				taskNameSet[taskName] = true
			}
		}
		for _, serviceName := range def.ServiceNames {
			serviceName = strings.TrimSpace(serviceName)
			if serviceName != "" {
				serviceNameSet[serviceName] = true
			}
		}
		for _, runValueName := range def.RunValueNames {
			runValueName = strings.TrimSpace(runValueName)
			if runValueName != "" {
				runValueSet[runValueName] = true
			}
		}
		for _, candidate := range collectKnownPaths(def, host) {
			addNormalizedPath(knownRootPathsSet, candidate)
		}
		for _, pattern := range def.TempGlobs {
			pattern = strings.TrimSpace(pattern)
			if pattern != "" {
				tempGlobsSet[pattern] = true
			}
		}
	}

	return inspectionTargets{
		ProcessNames:   sortedKeys(processNameSet),
		InternalNames:  sortedKeys(internalNameSet),
		KnownRootPaths: sortedKeys(knownRootPathsSet),
		TaskNames:      sortedKeys(taskNameSet),
		ServiceNames:   sortedKeys(serviceNameSet),
		RunValueNames:  sortedKeys(runValueSet),
		TempGlobs:      sortedKeys(tempGlobsSet),
	}
}

func inspectHost(scope []string, host hostPaths) inspection {
	targets := buildInspectionTargets(scope, host)
	var (
		processes  []runningProcess
		processErr error
		tasks      map[string][]string
		taskErr    error
		services   map[string][]string
		serviceErr error
		runValues  map[string][]string
		runErr     error
	)

	var wg sync.WaitGroup
	wg.Add(4)
	go func() {
		defer wg.Done()
		processes, processErr = listProcesses()
	}()
	go func() {
		defer wg.Done()
		tasks, taskErr = snapshotTasks(targets.TaskNames)
	}()
	go func() {
		defer wg.Done()
		services, serviceErr = snapshotServices(targets.ServiceNames)
	}()
	go func() {
		defer wg.Done()
		runValues, runErr = snapshotRunValues(targets.RunValueNames)
	}()
	wg.Wait()

	if processErr != nil {
		fmt.Fprintf(os.Stderr, "warning: enumerate processes: %v\n", processErr)
		processes = nil
	}
	if taskErr != nil {
		fmt.Fprintf(os.Stderr, "warning: enumerate scheduled tasks: %v\n", taskErr)
		tasks = nil
	}
	if serviceErr != nil {
		fmt.Fprintf(os.Stderr, "warning: enumerate services: %v\n", serviceErr)
		services = nil
	}
	if runErr != nil {
		fmt.Fprintf(os.Stderr, "warning: enumerate run values: %v\n", runErr)
		runValues = nil
	}

	presentPathsSet := map[string]bool{}
	dynamicPathsSet := map[string]bool{}
	tempPathsSet := map[string]bool{}
	exactExecutablePathsSet := map[string]bool{}

	for _, candidate := range targets.KnownRootPaths {
		if pathExists(candidate) {
			addNormalizedPath(presentPathsSet, candidate)
		}
	}

	for _, candidates := range tasks {
		for _, candidate := range candidates {
			addNormalizedPath(dynamicPathsSet, candidate)
			addNormalizedPath(exactExecutablePathsSet, candidate)
		}
	}
	for _, candidates := range services {
		for _, candidate := range candidates {
			addNormalizedPath(dynamicPathsSet, candidate)
			addNormalizedPath(exactExecutablePathsSet, candidate)
		}
	}
	for _, candidates := range runValues {
		for _, candidate := range candidates {
			addNormalizedPath(dynamicPathsSet, candidate)
			addNormalizedPath(exactExecutablePathsSet, candidate)
		}
	}

	for _, candidate := range expandTempGlobs(targets.TempGlobs, host.Temp) {
		addNormalizedPath(tempPathsSet, candidate)
	}

	selfPath := ""
	if executablePath, err := os.Executable(); err == nil {
		selfPath = normalizePath(executablePath)
	}

	matchedProcesses := matchProcesses(
		processes,
		targets.ProcessNames,
		targets.InternalNames,
		targets.KnownRootPaths,
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
		PresentTasks:     sortedStringSliceMapKeys(tasks),
		PresentServices:  sortedStringSliceMapKeys(services),
		PresentRunValues: sortedStringSliceMapKeys(runValues),
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

	for _, taskName := range report.PresentTasks {
		ok, missing, err := deleteScheduledTask(taskName, dryRun)
		record(ok, missing, "task "+taskName, err)
	}

	for _, serviceName := range report.PresentServices {
		ok, missing, err := deleteService(serviceName, dryRun)
		record(ok, missing, "service "+serviceName, err)
	}

	for _, runValue := range report.PresentRunValues {
		ok, missing, err := deleteRunValue(runValue, dryRun)
		record(ok, missing, "run key "+runValue, err)
	}

	for _, process := range report.MatchedProcesses {
		ok, missing, err := killProcess(process, dryRun)
		record(ok, missing, describeProcess(process), err)
	}

	for _, candidate := range pathsForRemoval(report.DynamicPaths, report.PresentPaths) {
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
	script := "$ErrorActionPreference='SilentlyContinue'; " +
		"$emptyVersion = [pscustomobject]@{ CompanyName = ''; FileDescription = ''; ProductName = ''; OriginalFilename = ''; InternalName = ''; Comments = '' }; " +
		"$versionCache = @{}; " +
		"$items = @(Get-CimInstance Win32_Process | ForEach-Object { " +
		"$path = [string]$_.ExecutablePath; " +
		"$version = $emptyVersion; " +
		"if ($path) { " +
		"if (-not $versionCache.ContainsKey($path)) { " +
		"$cached = $emptyVersion; " +
		"if (Test-Path -LiteralPath $path) { try { $info = (Get-Item -LiteralPath $path).VersionInfo; if ($info) { $cached = [pscustomobject]@{ CompanyName = [string]$info.CompanyName; FileDescription = [string]$info.FileDescription; ProductName = [string]$info.ProductName; OriginalFilename = [string]$info.OriginalFilename; InternalName = [string]$info.InternalName; Comments = [string]$info.Comments } } } catch {} } " +
		"$versionCache[$path] = $cached } " +
		"$version = $versionCache[$path] } " +
		"[pscustomobject]@{ ProcessId = [int]$_.ProcessId; Name = [string]$_.Name; ExecutablePath = $path; CompanyName = [string]$version.CompanyName; FileDescription = [string]$version.FileDescription; ProductName = [string]$version.ProductName; OriginalFilename = [string]$version.OriginalFilename; InternalName = [string]$version.InternalName; Comments = [string]$version.Comments } " +
		"}); $items | ConvertTo-Json -Compress -Depth 4"
	output, err := runCommandOutput(externalCommandTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err != nil {
		return nil, err
	}

	return parseProcessListOutput(output)
}

func parseProcessListOutput(output []byte) ([]runningProcess, error) {
	records, err := decodeJSONArray[processRecord](output)
	if err != nil {
		return nil, err
	}

	processes := make([]runningProcess, 0, len(records))
	for _, record := range records {
		name := strings.ToLower(strings.TrimSpace(record.Name))
		if name == "" {
			continue
		}
		processes = append(processes, runningProcess{
			PID:             record.ProcessID,
			Name:            name,
			Path:            normalizePath(record.ExecutablePath),
			CompanyName:     strings.TrimSpace(record.CompanyName),
			FileDescription: strings.TrimSpace(record.FileDescription),
			ProductName:     strings.TrimSpace(record.ProductName),
			OriginalName:    strings.TrimSpace(record.OriginalName),
			InternalName:    strings.TrimSpace(record.InternalName),
			Comments:        strings.TrimSpace(record.Comments),
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

func snapshotTasks(taskNames []string) (map[string][]string, error) {
	taskNames = uniqueSorted(taskNames)
	if len(taskNames) == 0 {
		return map[string][]string{}, nil
	}

	script := "$ErrorActionPreference='SilentlyContinue'; " +
		"$targets = " + psStringArrayLiteral(taskNames) + "; " +
		"$targetSet = @{}; foreach ($name in $targets) { $targetSet[$name] = $true }; " +
		"$items = @(); " +
		"try { $items = @(Get-ScheduledTask | Where-Object { $targetSet.ContainsKey($_.TaskName) } | ForEach-Object { $commands = @(); foreach ($action in $_.Actions) { if ($action.Execute) { $commands += [string]$action.Execute } elseif ($action.Command) { $commands += [string]$action.Command } }; [pscustomobject]@{ Name = [string]$_.TaskName; Commands = @($commands) } }) } catch {}; " +
		"$items | ConvertTo-Json -Compress -Depth 5"
	output, err := runCommandOutput(externalCommandTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err == nil {
		snapshot, parseErr := parseTaskSnapshotOutput(output)
		if parseErr == nil {
			return snapshot, nil
		}
		err = parseErr
	}

	snapshot := make(map[string][]string, len(taskNames))
	for _, taskName := range taskNames {
		if !taskExists(taskName) {
			continue
		}
		snapshot[taskName] = discoverTaskExecutablePaths(taskName)
	}
	if len(snapshot) > 0 {
		return snapshot, nil
	}
	return snapshot, err
}

func parseTaskSnapshotOutput(output []byte) (map[string][]string, error) {
	records, err := decodeJSONArray[taskSnapshotRecord](output)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[string][]string, len(records))
	for _, record := range records {
		name := strings.TrimSpace(record.Name)
		if name == "" {
			continue
		}
		paths := make([]string, 0, len(record.Commands))
		for _, command := range record.Commands {
			addIfExecutablePath(&paths, command)
		}
		snapshot[name] = uniqueSorted(paths)
	}
	return snapshot, nil
}

func snapshotServices(serviceNames []string) (map[string][]string, error) {
	serviceNames = uniqueSorted(serviceNames)
	if len(serviceNames) == 0 {
		return map[string][]string{}, nil
	}

	script := "$ErrorActionPreference='SilentlyContinue'; " +
		"$targets = " + psStringArrayLiteral(serviceNames) + "; " +
		"$targetSet = @{}; foreach ($name in $targets) { $targetSet[$name] = $true }; " +
		"$items = @(); " +
		"try { $items = @(Get-CimInstance Win32_Service | Where-Object { $targetSet.ContainsKey($_.Name) } | ForEach-Object { [pscustomobject]@{ Name = [string]$_.Name; PathName = [string]$_.PathName } }) } catch {}; " +
		"$items | ConvertTo-Json -Compress -Depth 4"
	output, err := runCommandOutput(externalCommandTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err == nil {
		snapshot, parseErr := parseServiceSnapshotOutput(output)
		if parseErr == nil {
			return snapshot, nil
		}
		err = parseErr
	}

	snapshot := make(map[string][]string, len(serviceNames))
	for _, serviceName := range serviceNames {
		if !serviceExists(serviceName) {
			continue
		}
		snapshot[serviceName] = discoverServiceExecutablePaths(serviceName)
	}
	if len(snapshot) > 0 {
		return snapshot, nil
	}
	return snapshot, err
}

func parseServiceSnapshotOutput(output []byte) (map[string][]string, error) {
	records, err := decodeJSONArray[serviceSnapshotRecord](output)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[string][]string, len(records))
	for _, record := range records {
		name := strings.TrimSpace(record.Name)
		if name == "" {
			continue
		}
		paths := make([]string, 0, 1)
		addIfExecutablePath(&paths, record.PathName)
		snapshot[name] = uniqueSorted(paths)
	}
	return snapshot, nil
}

func snapshotRunValues(valueNames []string) (map[string][]string, error) {
	valueNames = uniqueSorted(valueNames)
	if len(valueNames) == 0 {
		return map[string][]string{}, nil
	}

	script := "$ErrorActionPreference='SilentlyContinue'; " +
		"$targets = " + psStringArrayLiteral(valueNames) + "; " +
		"$items = @(); " +
		"try { $values = Get-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; foreach ($name in $targets) { $property = $values.PSObject.Properties[$name]; if ($property) { $items += [pscustomobject]@{ Name = [string]$name; Command = [string]$property.Value } } } } catch {}; " +
		"$items | ConvertTo-Json -Compress -Depth 4"
	output, err := runCommandOutput(externalCommandTimeout, "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err == nil {
		snapshot, parseErr := parseRunValueSnapshotOutput(output)
		if parseErr == nil {
			return snapshot, nil
		}
		err = parseErr
	}

	snapshot := make(map[string][]string, len(valueNames))
	for _, valueName := range valueNames {
		if !runValueExists(valueName) {
			continue
		}
		snapshot[valueName] = discoverRunValueExecutablePaths(valueName)
	}
	if len(snapshot) > 0 {
		return snapshot, nil
	}
	return snapshot, err
}

func parseRunValueSnapshotOutput(output []byte) (map[string][]string, error) {
	records, err := decodeJSONArray[runValueSnapshotRecord](output)
	if err != nil {
		return nil, err
	}

	snapshot := make(map[string][]string, len(records))
	for _, record := range records {
		name := strings.TrimSpace(record.Name)
		if name == "" {
			continue
		}
		paths := make([]string, 0, 1)
		addIfExecutablePath(&paths, record.Command)
		snapshot[name] = uniqueSorted(paths)
	}
	return snapshot, nil
}

func decodeJSONArray[T any](output []byte) ([]T, error) {
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil, nil
	}

	if trimmed[0] == '[' {
		var records []T
		if err := json.Unmarshal(trimmed, &records); err != nil {
			return nil, err
		}
		return records, nil
	}

	var record T
	if err := json.Unmarshal(trimmed, &record); err != nil {
		return nil, err
	}
	return []T{record}, nil
}

func runCommandOutput(timeout time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	output, err := exec.CommandContext(ctx, name, args...).Output()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return nil, fmt.Errorf("%s timed out after %s", name, timeout)
	}
	return output, err
}

func runCommandCombinedOutput(timeout time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return output, fmt.Errorf("%s timed out after %s", name, timeout)
	}
	return output, err
}

func commandSucceeds(timeout time.Duration, name string, args ...string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	return exec.CommandContext(ctx, name, args...).Run() == nil
}

func psStringArrayLiteral(items []string) string {
	if len(items) == 0 {
		return "@()"
	}

	quoted := make([]string, 0, len(items))
	for _, item := range items {
		quoted = append(quoted, "'"+strings.ReplaceAll(item, "'", "''")+"'")
	}
	return "@(" + strings.Join(quoted, ",") + ")"
}

func taskExists(taskName string) bool {
	return commandSucceeds(externalCommandTimeout, "schtasks", "/Query", "/TN", taskName)
}

func runValueExists(valueName string) bool {
	return commandSucceeds(externalCommandTimeout, "reg", "query", runKeyPath, "/v", valueName)
}

func discoverTaskExecutablePaths(taskName string) []string {
	output, err := runCommandOutput(externalCommandTimeout, "schtasks", "/Query", "/TN", taskName, "/XML")
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
	return commandSucceeds(externalCommandTimeout, "sc.exe", "query", serviceName)
}

func discoverServiceExecutablePaths(serviceName string) []string {
	output, err := runCommandOutput(externalCommandTimeout, "sc.exe", "qc", serviceName)
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
	output, err := runCommandOutput(externalCommandTimeout, "reg", "query", runKeyPath, "/v", valueName)
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

func expandTempGlobs(patterns []string, tempRoot string) []string {
	if strings.TrimSpace(tempRoot) == "" {
		return nil
	}

	paths := make([]string, 0)
	for _, pattern := range patterns {
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
	if output, err := runCommandCombinedOutput(externalCommandTimeout, "schtasks", "/Delete", "/TN", taskName, "/F"); err != nil {
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

	if output, err := runCommandCombinedOutput(externalCommandTimeout, "sc.exe", "stop", serviceName); err != nil {
		lower := strings.ToLower(string(output))
		if !strings.Contains(lower, "service has not been started") &&
			!strings.Contains(lower, "service not active") &&
			!strings.Contains(lower, "service cannot accept control messages at this time") {
			return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
		}
	}

	if output, err := runCommandCombinedOutput(externalCommandTimeout, "sc.exe", "delete", serviceName); err != nil {
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
	if output, err := runCommandCombinedOutput(externalCommandTimeout, "reg", "delete", runKeyPath, "/v", valueName, "/f"); err != nil {
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
	if output, err := runCommandCombinedOutput(externalCommandTimeout, "taskkill", "/F", "/T", "/PID", strconv.Itoa(process.PID)); err != nil {
		return false, false, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return true, false, nil
}

func processRunning(pid int) bool {
	output, err := runCommandOutput(externalCommandTimeout, "tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH", "/FO", "CSV")
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

func sortedStringSliceMapKeys(set map[string][]string) []string {
	items := make([]string, 0, len(set))
	for item := range set {
		items = append(items, item)
	}
	sort.Strings(items)
	return items
}

func pathsForRemoval(dynamicPaths []string, knownPaths []string) []string {
	paths := uniqueSorted(append(append([]string(nil), dynamicPaths...), knownPaths...))
	sort.Slice(paths, func(i, j int) bool {
		leftDepth := pathDepth(paths[i])
		rightDepth := pathDepth(paths[j])
		if leftDepth != rightDepth {
			return leftDepth > rightDepth
		}
		if len(paths[i]) != len(paths[j]) {
			return len(paths[i]) > len(paths[j])
		}
		return strings.ToLower(paths[i]) < strings.ToLower(paths[j])
	})
	return paths
}

func pathDepth(candidate string) int {
	cleaned := normalizePath(candidate)
	if cleaned == "" {
		return 0
	}
	return strings.Count(cleaned, `\`) + strings.Count(cleaned, `/`)
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
