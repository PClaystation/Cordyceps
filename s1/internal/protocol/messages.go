package protocol

type HelloMessage struct {
	Kind         string   `json:"kind"`
	DeviceID     string   `json:"device_id"`
	Token        string   `json:"token"`
	Version      string   `json:"version"`
	Hostname     string   `json:"hostname"`
	Username     string   `json:"username"`
	Capabilities []string `json:"capabilities"`
}

type HeartbeatMessage struct {
	Kind     string `json:"kind"`
	DeviceID string `json:"device_id"`
	SentAt   string `json:"sent_at"`
}

type CommandEnvelope struct {
	Kind      string         `json:"kind"`
	RequestID string         `json:"request_id"`
	DeviceID  string         `json:"device_id"`
	Type      string         `json:"type"`
	Args      map[string]any `json:"args"`
	IssuedAt  string         `json:"issued_at"`
}

type ResultMessage struct {
	Kind       string `json:"kind"`
	RequestID  string `json:"request_id"`
	DeviceID   string `json:"device_id"`
	OK         bool   `json:"ok"`
	Message    string `json:"message"`
	ErrorCode  string `json:"error_code,omitempty"`
	CompletedAt string `json:"completed_at"`
	Version    string `json:"version,omitempty"`
}
