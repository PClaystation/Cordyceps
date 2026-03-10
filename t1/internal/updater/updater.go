package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	maxPackageBytes int64 = 314572800
	maxVersionLen         = 64
)

var (
	updateMu         sync.Mutex
	updateInProgress bool
)

type Result struct {
	Message         string
	RestartRequired bool
}

type updateRequest struct {
	Version   string
	URL       string
	SHA256    string
	SizeBytes int64
}

func Apply(args map[string]any, executablePath string, cfgPath string) (Result, error) {
	if runtime.GOOS != "windows" {
		return Result{}, errors.New("AGENT_UPDATE is supported only on Windows")
	}

	if strings.TrimSpace(executablePath) == "" {
		return Result{}, errors.New("failed to resolve current executable path")
	}

	if strings.TrimSpace(cfgPath) == "" {
		return Result{}, errors.New("missing config path")
	}

	request, err := parseRequest(args)
	if err != nil {
		return Result{}, err
	}

	if err := beginUpdate(); err != nil {
		return Result{}, err
	}

	restartRequired := false
	defer func() {
		if !restartRequired {
			endUpdate()
		}
	}()

	currentHash, err := fileSHA256(executablePath)
	if err == nil && currentHash == request.SHA256 {
		return Result{
			Message:         fmt.Sprintf("Agent binary already matches update %s", request.Version),
			RestartRequired: false,
		}, nil
	}

	stagePath, err := stagePackage(request)
	if err != nil {
		return Result{}, err
	}

	scriptPath, err := writeUpdaterScript(executablePath, stagePath, cfgPath, request.Version)
	if err != nil {
		_ = os.Remove(stagePath)
		return Result{}, fmt.Errorf("create updater helper: %w", err)
	}

	if err := launchUpdaterScript(scriptPath); err != nil {
		_ = os.Remove(stagePath)
		_ = os.Remove(scriptPath)
		return Result{}, fmt.Errorf("launch updater helper: %w", err)
	}

	restartRequired = true
	return Result{
		Message:         fmt.Sprintf("Update %s staged. Agent is restarting now.", request.Version),
		RestartRequired: true,
	}, nil
}

func parseRequest(args map[string]any) (updateRequest, error) {
	version, err := readStringArg(args, "version")
	if err != nil {
		return updateRequest{}, err
	}

	if len(version) > maxVersionLen || !isSafeVersion(version) {
		return updateRequest{}, errors.New("version must match [A-Za-z0-9._-] and be at most 64 chars")
	}

	downloadURL, err := readStringArg(args, "url")
	if err != nil {
		return updateRequest{}, err
	}

	parsedURL, err := url.Parse(downloadURL)
	if err != nil || !parsedURL.IsAbs() {
		return updateRequest{}, errors.New("url must be a valid absolute URL")
	}
	if parsedURL.Scheme != "https" {
		return updateRequest{}, errors.New("url must use https")
	}

	shaValue, err := readStringArg(args, "sha256")
	if err != nil {
		return updateRequest{}, err
	}
	shaValue = strings.ToLower(strings.TrimSpace(shaValue))
	if !isSHA256(shaValue) {
		return updateRequest{}, errors.New("sha256 must be a 64-character hex string")
	}

	sizeBytes, err := readOptionalSizeArg(args, "size_bytes")
	if err != nil {
		return updateRequest{}, err
	}

	return updateRequest{
		Version:   version,
		URL:       parsedURL.String(),
		SHA256:    shaValue,
		SizeBytes: sizeBytes,
	}, nil
}

func stagePackage(request updateRequest) (string, error) {
	dir := os.TempDir()
	stagePath := filepath.Join(dir, fmt.Sprintf("t1-agent-update-%d.exe", time.Now().UTC().UnixNano()))
	partialPath := stagePath + ".part"

	_ = os.Remove(stagePath)
	_ = os.Remove(partialPath)

	if err := downloadAndVerify(request, partialPath); err != nil {
		_ = os.Remove(partialPath)
		return "", err
	}

	if err := os.Rename(partialPath, stagePath); err != nil {
		_ = os.Remove(partialPath)
		return "", fmt.Errorf("move staged package: %w", err)
	}

	return stagePath, nil
}

func downloadAndVerify(request updateRequest, outputPath string) error {
	client := &http.Client{
		Timeout: 15 * time.Minute,
	}

	req, err := http.NewRequest(http.MethodGet, request.URL, nil)
	if err != nil {
		return fmt.Errorf("build update download request: %w", err)
	}
	req.Header.Set("Accept", "application/octet-stream")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download update package: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("update package responded with HTTP %d", resp.StatusCode)
	}

	if resp.Request == nil || resp.Request.URL == nil {
		return errors.New("download response did not include a final URL")
	}

	finalURL := resp.Request.URL
	if finalURL.Scheme != "https" {
		return fmt.Errorf("update package redirected to non-https URL: %s", finalURL.String())
	}
	if finalURL.Host == "" {
		return errors.New("update package final URL is missing host")
	}
	if finalURL.User != nil {
		return errors.New("update package URL must not include credentials")
	}

	if resp.ContentLength > maxPackageBytes {
		return fmt.Errorf("package too large (%d bytes, max %d)", resp.ContentLength, maxPackageBytes)
	}

	file, err := os.OpenFile(outputPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create staged package file: %w", err)
	}

	hasher := sha256.New()
	limited := &io.LimitedReader{
		R: resp.Body,
		N: maxPackageBytes + 1,
	}

	written, copyErr := io.Copy(io.MultiWriter(file, hasher), limited)
	syncErr := file.Sync()
	closeErr := file.Close()

	if copyErr != nil {
		return fmt.Errorf("copy package payload: %w", copyErr)
	}
	if syncErr != nil {
		return fmt.Errorf("flush staged package: %w", syncErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close staged package: %w", closeErr)
	}

	if written <= 0 {
		return errors.New("downloaded package was empty")
	}

	if written > maxPackageBytes {
		return fmt.Errorf("package too large (%d bytes, max %d)", written, maxPackageBytes)
	}

	if request.SizeBytes > 0 && written != request.SizeBytes {
		return fmt.Errorf("package size mismatch: expected %d bytes, got %d", request.SizeBytes, written)
	}

	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if actualHash != request.SHA256 {
		return fmt.Errorf("sha256 mismatch: expected %s got %s", request.SHA256, actualHash)
	}

	if err := verifyWindowsExecutable(outputPath); err != nil {
		return err
	}

	return nil
}

func verifyWindowsExecutable(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open staged package for verification: %w", err)
	}
	defer file.Close()

	header := make([]byte, 2)
	if _, err := io.ReadFull(file, header); err != nil {
		return fmt.Errorf("read executable header: %w", err)
	}

	if header[0] != 'M' || header[1] != 'Z' {
		return errors.New("staged package is not a Windows executable (missing MZ header)")
	}

	return nil
}

func writeUpdaterScript(targetPath string, stagedPath string, cfgPath string, version string) (string, error) {
	scriptPath := filepath.Join(os.TempDir(), fmt.Sprintf("t1-agent-updater-%d.cmd", time.Now().UTC().UnixNano()))

	escape := func(value string) string {
		sanitized := strings.ReplaceAll(value, "%", "%%")
		sanitized = strings.ReplaceAll(sanitized, "\r", "")
		sanitized = strings.ReplaceAll(sanitized, "\n", "")
		return sanitized
	}

	body := strings.Join([]string{
		"@echo off",
		"setlocal enableextensions",
			fmt.Sprintf("set \"TARGET=%s\"", escape(targetPath)),
			fmt.Sprintf("set \"TARGET_DIR=%s\"", escape(filepath.Dir(targetPath))),
			fmt.Sprintf("set \"STAGED=%s\"", escape(stagedPath)),
			fmt.Sprintf("set \"CONFIG=%s\"", escape(cfgPath)),
			fmt.Sprintf("set \"VERSION=%s\"", escape(version)),
			"set \"BACKUP=%TARGET%.bak\"",
		"if exist \"%BACKUP%\" del /f /q \"%BACKUP%\" >nul 2>&1",
		"for /L %%I in (1,1,45) do (",
		"  move /Y \"%TARGET%\" \"%BACKUP%\" >nul 2>&1",
		"  if not errorlevel 1 goto swapped",
		"  timeout /t 1 /nobreak >nul",
		")",
			"start \"\" /D \"%TARGET_DIR%\" /B \"%TARGET%\" --config \"%CONFIG%\"",
			"del /f /q \"%STAGED%\" >nul 2>&1",
			"del /f /q \"%~f0\" >nul 2>&1",
			"exit /b 1",
		":swapped",
		"move /Y \"%STAGED%\" \"%TARGET%\" >nul 2>&1",
		"if errorlevel 1 goto rollback",
			"start \"\" /D \"%TARGET_DIR%\" /B \"%TARGET%\" --config \"%CONFIG%\" --version \"%VERSION%\"",
			"if errorlevel 1 goto rollback",
		"del /f /q \"%BACKUP%\" >nul 2>&1",
		"del /f /q \"%~f0\" >nul 2>&1",
		"exit /b 0",
		":rollback",
		"move /Y \"%BACKUP%\" \"%TARGET%\" >nul 2>&1",
		"start \"\" /D \"%TARGET_DIR%\" /B \"%TARGET%\" --config \"%CONFIG%\"",
		"del /f /q \"%STAGED%\" >nul 2>&1",
		"del /f /q \"%~f0\" >nul 2>&1",
		"exit /b 1",
		"",
	}, "\r\n")

	if err := os.WriteFile(scriptPath, []byte(body), 0o600); err != nil {
		return "", err
	}

	return scriptPath, nil
}

func launchUpdaterScript(scriptPath string) error {
	cmd := exec.Command("cmd", "/C", scriptPath)
	configureHiddenProcess(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = cmd.Process.Release()

	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func readStringArg(args map[string]any, key string) (string, error) {
	value, ok := args[key]
	if !ok {
		return "", fmt.Errorf("missing arg: %s", key)
	}

	asString, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("arg must be string: %s", key)
	}

	asString = strings.TrimSpace(asString)
	if asString == "" {
		return "", fmt.Errorf("arg must not be empty: %s", key)
	}

	return asString, nil
}

func readOptionalSizeArg(args map[string]any, key string) (int64, error) {
	value, ok := args[key]
	if !ok || value == nil {
		return 0, nil
	}

	switch typed := value.(type) {
	case float64:
		if typed <= 0 || typed != math.Trunc(typed) {
			return 0, fmt.Errorf("arg must be a positive integer: %s", key)
		}
		if typed > float64(maxPackageBytes) {
			return 0, fmt.Errorf("arg %s exceeds max allowed size (%d)", key, maxPackageBytes)
		}
		return int64(typed), nil
	case int:
		if typed <= 0 {
			return 0, fmt.Errorf("arg must be a positive integer: %s", key)
		}
		if int64(typed) > maxPackageBytes {
			return 0, fmt.Errorf("arg %s exceeds max allowed size (%d)", key, maxPackageBytes)
		}
		return int64(typed), nil
	case int64:
		if typed <= 0 {
			return 0, fmt.Errorf("arg must be a positive integer: %s", key)
		}
		if typed > maxPackageBytes {
			return 0, fmt.Errorf("arg %s exceeds max allowed size (%d)", key, maxPackageBytes)
		}
		return typed, nil
	default:
		return 0, fmt.Errorf("arg must be a number: %s", key)
	}
}

func isSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}

	for _, r := range value {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
			continue
		}
		return false
	}

	return true
}

func isSafeVersion(value string) bool {
	for _, r := range value {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			continue
		}
		return false
	}

	return true
}

func beginUpdate() error {
	updateMu.Lock()
	defer updateMu.Unlock()

	if updateInProgress {
		return errors.New("another update is already in progress")
	}

	updateInProgress = true
	return nil
}

func endUpdate() {
	updateMu.Lock()
	updateInProgress = false
	updateMu.Unlock()
}
