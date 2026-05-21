package commands

import (
	"fmt"
	"strings"
	"time"

	"github.com/charliearnerstal/cordyceps/ds1/internal/protocol"
)

func Capabilities() []string {
	return []string{
		"profile_ds",
		"ping_only_ds1",
	}
}

func Execute(deviceID string, version string, command protocol.CommandEnvelope) protocol.ResultMessage {
	commandType := strings.ToUpper(strings.TrimSpace(command.Type))
	result := protocol.ResultMessage{
		Kind:        "result",
		RequestID:   command.RequestID,
		DeviceID:    deviceID,
		CompletedAt: time.Now().UTC().Format(time.RFC3339),
		Version:     version,
		ResultPayload: map[string]any{
			"command_type": commandType,
		},
	}

	if commandType == "PING" {
		result.OK = true
		result.Message = fmt.Sprintf("%s is online", deviceID)
		return result
	}

	return protocol.ResultMessage{
		Kind:          result.Kind,
		RequestID:     result.RequestID,
		DeviceID:      result.DeviceID,
		OK:            false,
		Message:       fmt.Sprintf("%s is ping-only and rejects %s", deviceID, commandType),
		ErrorCode:     "COMMAND_NOT_ALLOWED",
		CompletedAt:   result.CompletedAt,
		Version:       result.Version,
		ResultPayload: result.ResultPayload,
	}
}
