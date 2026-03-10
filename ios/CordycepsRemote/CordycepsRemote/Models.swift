import Foundation

struct DeviceRecord: Decodable, Identifiable, Hashable {
  private static let preciseFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let fallbackFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  let device_id: String
  let display_name: String?
  let status: String
  let last_seen: String
  let version: String?
  let hostname: String?
  let username: String?

  var id: String { device_id }

  var isOnline: Bool {
    status.lowercased() == "online"
  }

  var lastSeenLabel: String {
    guard let date = DeviceRecord.preciseFormatter.date(from: last_seen)
      ?? DeviceRecord.fallbackFormatter.date(from: last_seen)
    else {
      return last_seen
    }

    return DateFormatter.cordyceps.string(from: date)
  }
}

struct DevicesResponse: Decodable {
  let ok: Bool
  let devices: [DeviceRecord]
}

struct DispatchResult: Decodable, Hashable {
  let device_id: String
  let ok: Bool
  let message: String
  let error_code: String?
}

struct CommandResponse: Decodable {
  let ok: Bool
  let request_id: String?
  let target: String?
  let parsed_type: String?
  let message: String?
  let error_code: String?
  let result: DispatchResult?
  let results: [DispatchResult]?
}

struct UpdateResponse: Decodable {
  let ok: Bool
  let request_id: String?
  let target: String?
  let parsed_type: String?
  let message: String?
  let error_code: String?
  let version: String?
  let package_url: String?
  let sha256: String?
  let hash_source: String?
  let package_size_bytes: Int?
  let result: DispatchResult?
  let results: [DispatchResult]?
}

struct ErrorResponse: Decodable {
  let ok: Bool?
  let message: String?
  let error: String?
  let error_code: String?
}

struct CommandRequest: Encodable {
  let request_id: String
  let text: String
  let source: String
  let sent_at: String
  let client_version: String
}

struct UpdateRequest: Encodable {
  let request_id: String
  let source: String
  let target: String
  let version: String
  let package_url: String
  let sha256: String?
  let size_bytes: Int?
}

struct APIResponse<T> {
  let body: T
  let rawJSON: String
  let latencyMs: Double
  let statusCode: Int
}

enum ConnectionState: String {
  case connected
  case retrying
  case disconnected
}

struct CommandCategoryGroup: Identifiable, Hashable {
  let category: String
  let entries: [CommandLibraryEntry]
  var id: String { category }
}

struct CommandLibraryEntry: Identifiable, Hashable {
  let value: String
  let label: String
  let category: String
  let keywords: [String]

  var id: String { value }

  var normalizedValue: String {
    value.normalizedActionText
  }

  var searchText: String {
    "\(normalizedValue) \(label.lowercased()) \(category.lowercased()) \(keywords.joined(separator: " ").lowercased())"
  }

  var isDangerous: Bool {
    CommandLibrary.dangerousActions.contains(normalizedValue)
  }

  var usesArgument: Bool {
    normalizedValue == "notify" || normalizedValue == "clipboard" || normalizedValue == "copy" || CommandLibrary.repeatableActions.contains(normalizedValue)
  }

  var placeholderArgument: String {
    if normalizedValue == "notify" {
      return "hello"
    }

    if normalizedValue == "clipboard" || normalizedValue == "copy" {
      return "copied from jarvis"
    }

    if CommandLibrary.repeatableActions.contains(normalizedValue) {
      return "optional repeat count"
    }

    return ""
  }
}

enum CommandLibrary {
  static let entries: [CommandLibraryEntry] = [
    .init(value: "ping", label: "ping", category: "Connectivity", keywords: ["status", "health", "check"]),
    .init(value: "play", label: "play", category: "Media", keywords: ["resume"]),
    .init(value: "pause", label: "pause", category: "Media", keywords: ["stop"]),
    .init(value: "play pause", label: "play pause", category: "Media", keywords: ["toggle"]),
    .init(value: "next", label: "next", category: "Media", keywords: ["skip", "next track", "repeat"]),
    .init(value: "previous", label: "previous", category: "Media", keywords: ["back", "prev", "previous track", "repeat"]),
    .init(value: "volume up", label: "volume up", category: "Volume", keywords: ["louder", "vol up", "volume higher", "repeat"]),
    .init(value: "volume down", label: "volume down", category: "Volume", keywords: ["quieter", "vol down", "volume lower", "repeat"]),
    .init(value: "mute", label: "mute", category: "Volume", keywords: ["mute volume", "silence", "unmute"]),
    .init(value: "open spotify", label: "open spotify", category: "Apps", keywords: ["launch spotify"]),
    .init(value: "open discord", label: "open discord", category: "Apps", keywords: ["launch discord"]),
    .init(value: "open chrome", label: "open chrome", category: "Apps", keywords: ["browser"]),
    .init(value: "open steam", label: "open steam", category: "Apps", keywords: ["games"]),
    .init(value: "open explorer", label: "open explorer", category: "Apps", keywords: ["file explorer", "windows explorer", "files"]),
    .init(value: "open vscode", label: "open vscode", category: "Apps", keywords: ["vs code", "visual studio code", "editor", "code"]),
    .init(value: "open edge", label: "open edge", category: "Apps", keywords: ["microsoft edge", "browser"]),
    .init(value: "open firefox", label: "open firefox", category: "Apps", keywords: ["browser"]),
    .init(value: "open notepad", label: "open notepad", category: "Apps", keywords: ["text"]),
    .init(value: "open calculator", label: "open calculator", category: "Apps", keywords: ["calc"]),
    .init(value: "open settings", label: "open settings", category: "Apps", keywords: ["windows settings"]),
    .init(value: "open slack", label: "open slack", category: "Apps", keywords: ["chat"]),
    .init(value: "open teams", label: "open teams", category: "Apps", keywords: ["meeting", "chat"]),
    .init(value: "open task manager", label: "open task manager", category: "Apps", keywords: ["taskmanager", "process"]),
    .init(value: "open terminal", label: "open terminal", category: "Apps", keywords: ["windows terminal", "wt"]),
    .init(value: "open powershell", label: "open powershell", category: "Apps", keywords: ["power shell", "shell"]),
    .init(value: "open cmd", label: "open cmd", category: "Apps", keywords: ["command prompt"]),
    .init(value: "open control panel", label: "open control panel", category: "Apps", keywords: ["controlpanel"]),
    .init(value: "open paint", label: "open paint", category: "Apps", keywords: ["mspaint"]),
    .init(value: "open snipping tool", label: "open snipping tool", category: "Apps", keywords: ["snippingtool", "screenshot"]),
    .init(value: "lock", label: "lock", category: "Power", keywords: ["lock pc"]),
    .init(value: "lock pc", label: "lock pc", category: "Power", keywords: ["lock"]),
    .init(value: "panic confirm", label: "panic confirm", category: "Emergency", keywords: ["lockdown confirm", "emergency confirm", "isolate"]),
    .init(value: "display off", label: "display off", category: "Power", keywords: ["screen off", "monitor off"]),
    .init(value: "screen off", label: "screen off", category: "Power", keywords: ["display off", "monitor off"]),
    .init(value: "monitor off", label: "monitor off", category: "Power", keywords: ["display off", "screen off"]),
    .init(value: "sleep", label: "sleep", category: "Power", keywords: ["sleep pc"]),
    .init(value: "sleep pc", label: "sleep pc", category: "Power", keywords: ["sleep"]),
    .init(value: "sign out", label: "sign out", category: "Power", keywords: ["log out", "logout"]),
    .init(value: "log out", label: "log out", category: "Power", keywords: ["sign out", "logout"]),
    .init(value: "logout", label: "logout", category: "Power", keywords: ["sign out", "log out"]),
    .init(value: "shutdown", label: "shutdown", category: "Power", keywords: ["shut down", "shutdown pc"]),
    .init(value: "restart", label: "restart", category: "Power", keywords: ["reboot", "restart pc"]),
    .init(value: "notify", label: "notify (requires message)", category: "Messaging", keywords: ["alert", "notification"]),
    .init(value: "clipboard", label: "clipboard (requires text)", category: "Messaging", keywords: ["copy", "copy text"]),
    .init(value: "copy", label: "copy (requires text)", category: "Messaging", keywords: ["clipboard", "copy text"]),
  ]

  static let knownActionValues = Set(entries.map { $0.normalizedValue })
  static let actionAliases: [String: String] = [
    "status": "ping",
    "resume": "play",
    "toggle": "play pause",
    "next track": "next",
    "skip": "next",
    "skip track": "next",
    "previous track": "previous",
    "prev": "previous",
    "back": "previous",
    "vol up": "volume up",
    "louder": "volume up",
    "volume higher": "volume up",
    "vol down": "volume down",
    "quieter": "volume down",
    "volume lower": "volume down",
    "mute volume": "mute",
    "open file explorer": "open explorer",
    "open vs code": "open vscode",
    "open visual studio code": "open vscode",
    "open microsoft edge": "open edge",
    "open calc": "open calculator",
    "open taskmanager": "open task manager",
    "open windows terminal": "open terminal",
    "open power shell": "open powershell",
    "open command prompt": "open cmd",
    "open mspaint": "open paint",
    "lock pc": "lock",
    "panic confirmed": "panic confirm",
    "panic mode confirm": "panic confirm",
    "lockdown confirm": "panic confirm",
    "emergency confirm": "panic confirm",
    "emergency mode confirm": "panic confirm",
    "sleep pc": "sleep",
    "shut down": "shutdown",
    "shutdown pc": "shutdown",
    "reboot": "restart",
    "restart pc": "restart",
  ]
  static let repeatableActions: Set<String> = [
    "volume up",
    "volume down",
    "next",
    "previous",
  ]
  static let dangerousActions: Set<String> = [
    "shutdown",
    "restart",
    "sleep",
    "sleep pc",
    "sign out",
    "log out",
    "logout",
    "panic confirm",
  ]

  static let quickActions: [String] = [
    "ping",
    "play pause",
    "next",
    "volume up",
    "volume down",
    "mute",
    "lock",
    "restart",
  ]

  static func entry(for value: String) -> CommandLibraryEntry? {
    let normalized = value.normalizedActionText
    return entries.first(where: { $0.normalizedValue == normalized })
  }

  static func filteredEntries(matching query: String) -> [CommandLibraryEntry] {
    let normalized = query.normalizedActionText
    if normalized.isEmpty {
      return entries
    }

    let terms = normalized.split(separator: " ").map(String.init)
    return entries.filter { entry in
      terms.allSatisfy { term in
        entry.searchText.contains(term)
      }
    }
  }

  static func grouped(entries: [CommandLibraryEntry]) -> [CommandCategoryGroup] {
    let sorted = entries.sorted {
      if $0.category == $1.category {
        return $0.label < $1.label
      }
      return $0.category < $1.category
    }

    let groupedDict = Dictionary(grouping: sorted, by: \.category)
    return groupedDict.keys.sorted().map { category in
      CommandCategoryGroup(category: category, entries: groupedDict[category] ?? [])
    }
  }

  static func safeAction(_ value: String) -> String {
    let normalized = value.normalizedActionText
    let canonical = actionAliases[normalized] ?? normalized
    if knownActionValues.contains(canonical) {
      return canonical
    }
    return "ping"
  }
}

extension String {
  var normalizedActionText: String {
    lowercased()
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
  }

  var decodedURLValue: String {
    replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? self
  }
}

extension DateFormatter {
  static let cordyceps: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .short
    formatter.timeStyle = .medium
    return formatter
  }()
}
