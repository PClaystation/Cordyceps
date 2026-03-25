package commands

import (
	"fmt"
	"strings"
	"time"

	"github.com/charliearnerstal/jarvis/d1/internal/protocol"
)

func Capabilities() []string {
	return []string{
		"profile_d",
		"updater",
		"privileged_helper_split",
		"updater_only_d1",
	}
}

func Execute(deviceID string, version string, command protocol.CommandEnvelope) protocol.ResultMessage {
	commandType := strings.ToUpper(strings.TrimSpace(command.Type))
	return protocol.ResultMessage{
		Kind:        "result",
		RequestID:   command.RequestID,
		DeviceID:    deviceID,
		OK:          false,
		Message:     fmt.Sprintf("%s is updater-only and rejects %s", deviceID, commandType),
		ErrorCode:   "COMMAND_NOT_ALLOWED",
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
		Version:     version,
		ResultPayload: map[string]any{
			"command_type": commandType,
		},
	}
}
