package main

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"
)

const windowsDeviceInfoScript = `
$ErrorActionPreference = 'Stop'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
[PSCustomObject]@{
  os_caption = [string]$os.Caption
  os_version = [string]$os.Version
  os_build = [string]$os.BuildNumber
  os_last_boot_utc = ([DateTime]$os.LastBootUpTime).ToUniversalTime().ToString('o')
  host_manufacturer = [string]$cs.Manufacturer
  host_model = [string]$cs.Model
  host_domain = [string]$cs.Domain
  host_total_memory_bytes = [Int64]$cs.TotalPhysicalMemory
  host_free_memory_bytes = ([Int64]$os.FreePhysicalMemory * 1024)
  bios_serial = [string]$bios.SerialNumber
  cpu_name = [string]$cpu.Name
  cpu_physical_cores = [int]$cpu.NumberOfCores
  cpu_logical_processors = [int]$cpu.NumberOfLogicalProcessors
} | ConvertTo-Json -Compress
`

func collectDeviceInfo(hostname string, username string, capabilities []string) map[string]any {
	now := time.Now()
	_, offsetSeconds := now.Zone()

	info := map[string]any{
		"captured_at":             now.UTC().Format(time.RFC3339),
		"runtime_os":              runtime.GOOS,
		"runtime_arch":            runtime.GOARCH,
		"go_version":              runtime.Version(),
		"cpu_logical_cores":       runtime.NumCPU(),
		"process_id":              os.Getpid(),
		"timezone":                now.Location().String(),
		"timezone_offset_minutes": offsetSeconds / 60,
		"hostname_reported":       strings.TrimSpace(hostname),
		"username_reported":       strings.TrimSpace(username),
		"capability_count":        len(capabilities),
	}

	if executablePath, err := os.Executable(); err == nil {
		if trimmed := strings.TrimSpace(executablePath); trimmed != "" {
			info["executable_path"] = trimmed
		}
	}

	if workingDirectory, err := os.Getwd(); err == nil {
		if trimmed := strings.TrimSpace(workingDirectory); trimmed != "" {
			info["working_directory"] = trimmed
		}
	}

	networkAdapters, localIPs := collectNetworkSnapshot()
	if len(networkAdapters) > 0 {
		info["network_adapters"] = networkAdapters
	}
	if len(localIPs) > 0 {
		info["local_ips"] = localIPs
	}

	if runtime.GOOS == "windows" {
		for key, value := range collectWindowsDeviceInfo() {
			info[key] = value
		}
	}

	return info
}

func collectNetworkSnapshot() ([]map[string]any, []string) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, nil
	}

	sort.SliceStable(interfaces, func(left int, right int) bool {
		if interfaces[left].Index == interfaces[right].Index {
			return interfaces[left].Name < interfaces[right].Name
		}
		return interfaces[left].Index < interfaces[right].Index
	})

	adapters := make([]map[string]any, 0, len(interfaces))
	localIPSet := make(map[string]struct{})

	for _, iface := range interfaces {
		entry := map[string]any{
			"name":  strings.TrimSpace(iface.Name),
			"index": iface.Index,
		}

		if iface.MTU > 0 {
			entry["mtu"] = iface.MTU
		}

		if mac := strings.ToLower(strings.TrimSpace(iface.HardwareAddr.String())); mac != "" {
			entry["mac"] = mac
		}

		if flags := interfaceFlags(iface.Flags); len(flags) > 0 {
			entry["flags"] = flags
		}

		addresses := make([]string, 0)
		if addrs, addrErr := iface.Addrs(); addrErr == nil {
			for _, addr := range addrs {
				text := strings.TrimSpace(addr.String())
				if text == "" {
					continue
				}
				addresses = append(addresses, text)

				ipText := extractIPText(addr)
				if ipText == "" {
					continue
				}
				if ip := net.ParseIP(ipText); ip != nil && ip.IsLoopback() {
					continue
				}
				localIPSet[ipText] = struct{}{}
			}
		}

		if len(addresses) > 0 {
			sort.Strings(addresses)
			entry["addresses"] = addresses
		}

		if len(entry) > 0 {
			adapters = append(adapters, entry)
		}
	}

	localIPs := make([]string, 0, len(localIPSet))
	for value := range localIPSet {
		localIPs = append(localIPs, value)
	}
	sort.Strings(localIPs)

	return adapters, localIPs
}

func extractIPText(addr net.Addr) string {
	switch typed := addr.(type) {
	case *net.IPNet:
		if typed.IP == nil {
			return ""
		}
		return typed.IP.String()
	case *net.IPAddr:
		if typed.IP == nil {
			return ""
		}
		return typed.IP.String()
	default:
		text := strings.TrimSpace(addr.String())
		if text == "" {
			return ""
		}
		if strings.Contains(text, "/") {
			if ip, _, err := net.ParseCIDR(text); err == nil && ip != nil {
				return ip.String()
			}
		}
		if ip := net.ParseIP(text); ip != nil {
			return ip.String()
		}
		return ""
	}
}

func interfaceFlags(flags net.Flags) []string {
	labels := make([]string, 0, 6)
	if flags&net.FlagUp != 0 {
		labels = append(labels, "up")
	}
	if flags&net.FlagBroadcast != 0 {
		labels = append(labels, "broadcast")
	}
	if flags&net.FlagLoopback != 0 {
		labels = append(labels, "loopback")
	}
	if flags&net.FlagPointToPoint != 0 {
		labels = append(labels, "point_to_point")
	}
	if flags&net.FlagMulticast != 0 {
		labels = append(labels, "multicast")
	}
	if flags&net.FlagRunning != 0 {
		labels = append(labels, "running")
	}
	return labels
}

func collectWindowsDeviceInfo() map[string]any {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	command := exec.CommandContext(
		ctx,
		"powershell",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-Command",
		windowsDeviceInfoScript,
	)

	output, err := command.Output()
	if err != nil {
		return map[string]any{}
	}

	parsed := make(map[string]any)
	if err := json.Unmarshal(output, &parsed); err != nil {
		return map[string]any{}
	}

	normalized := make(map[string]any, len(parsed))
	for key, value := range parsed {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		if normalizedKey == "" || value == nil {
			continue
		}
		normalized[normalizedKey] = value
	}

	return normalized
}
