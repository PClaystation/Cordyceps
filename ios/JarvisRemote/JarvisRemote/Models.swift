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

    return DateFormatter.jarvis.string(from: date)
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
    normalizedValue == "notify" || CommandLibrary.repeatableActions.contains(normalizedValue)
  }

  var placeholderArgument: String {
    if normalizedValue == "notify" {
      return "hello"
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
    .init(value: "status", label: "status", category: "Connectivity", keywords: ["ping", "health", "check"]),
    .init(value: "play", label: "play", category: "Media", keywords: ["resume"]),
    .init(value: "resume", label: "resume", category: "Media", keywords: ["play"]),
    .init(value: "pause", label: "pause", category: "Media", keywords: ["stop"]),
    .init(value: "play pause", label: "play pause", category: "Media", keywords: ["toggle"]),
    .init(value: "toggle", label: "toggle", category: "Media", keywords: ["play", "pause"]),
    .init(value: "next", label: "next", category: "Media", keywords: ["skip", "track", "repeat"]),
    .init(value: "next track", label: "next track", category: "Media", keywords: ["skip", "next", "repeat"]),
    .init(value: "skip", label: "skip", category: "Media", keywords: ["next", "track", "repeat"]),
    .init(value: "skip track", label: "skip track", category: "Media", keywords: ["next", "skip", "repeat"]),
    .init(value: "previous", label: "previous", category: "Media", keywords: ["back", "track", "repeat"]),
    .init(value: "previous track", label: "previous track", category: "Media", keywords: ["back", "prev", "repeat"]),
    .init(value: "prev", label: "prev", category: "Media", keywords: ["previous", "back", "repeat"]),
    .init(value: "back", label: "back", category: "Media", keywords: ["previous", "track", "repeat"]),
    .init(value: "volume up", label: "volume up", category: "Volume", keywords: ["louder", "vol up", "repeat"]),
    .init(value: "vol up", label: "vol up", category: "Volume", keywords: ["volume up", "louder", "repeat"]),
    .init(value: "louder", label: "louder", category: "Volume", keywords: ["volume up", "repeat"]),
    .init(value: "volume higher", label: "volume higher", category: "Volume", keywords: ["volume up", "repeat"]),
    .init(value: "volume down", label: "volume down", category: "Volume", keywords: ["quieter", "vol down", "repeat"]),
    .init(value: "vol down", label: "vol down", category: "Volume", keywords: ["volume down", "quieter", "repeat"]),
    .init(value: "quieter", label: "quieter", category: "Volume", keywords: ["volume down", "repeat"]),
    .init(value: "volume lower", label: "volume lower", category: "Volume", keywords: ["volume down", "repeat"]),
    .init(value: "mute", label: "mute", category: "Volume", keywords: ["mute volume", "silence"]),
    .init(value: "mute volume", label: "mute volume", category: "Volume", keywords: ["mute", "silence"]),
    .init(value: "open spotify", label: "open spotify", category: "Apps", keywords: ["launch spotify"]),
    .init(value: "open discord", label: "open discord", category: "Apps", keywords: ["launch discord"]),
    .init(value: "open chrome", label: "open chrome", category: "Apps", keywords: ["browser"]),
    .init(value: "open steam", label: "open steam", category: "Apps", keywords: ["games"]),
    .init(value: "open explorer", label: "open explorer", category: "Apps", keywords: ["files", "windows explorer"]),
    .init(value: "open file explorer", label: "open file explorer", category: "Apps", keywords: ["explorer", "files"]),
    .init(value: "open vscode", label: "open vscode", category: "Apps", keywords: ["editor", "code"]),
    .init(value: "open vs code", label: "open vs code", category: "Apps", keywords: ["vscode", "editor"]),
    .init(value: "open visual studio code", label: "open visual studio code", category: "Apps", keywords: ["vscode", "editor"]),
    .init(value: "open edge", label: "open edge", category: "Apps", keywords: ["browser", "microsoft edge"]),
    .init(value: "open microsoft edge", label: "open microsoft edge", category: "Apps", keywords: ["edge", "browser"]),
    .init(value: "open firefox", label: "open firefox", category: "Apps", keywords: ["browser"]),
    .init(value: "open notepad", label: "open notepad", category: "Apps", keywords: ["text"]),
    .init(value: "open calculator", label: "open calculator", category: "Apps", keywords: ["calc"]),
    .init(value: "open calc", label: "open calc", category: "Apps", keywords: ["calculator"]),
    .init(value: "open settings", label: "open settings", category: "Apps", keywords: ["windows settings"]),
    .init(value: "open slack", label: "open slack", category: "Apps", keywords: ["chat"]),
    .init(value: "open teams", label: "open teams", category: "Apps", keywords: ["meeting", "chat"]),
    .init(value: "open task manager", label: "open task manager", category: "Apps", keywords: ["taskmanager", "process"]),
    .init(value: "open taskmanager", label: "open taskmanager", category: "Apps", keywords: ["task manager", "process"]),
    .init(value: "open terminal", label: "open terminal", category: "Apps", keywords: ["windows terminal", "wt"]),
    .init(value: "open windows terminal", label: "open windows terminal", category: "Apps", keywords: ["terminal", "wt"]),
    .init(value: "open powershell", label: "open powershell", category: "Apps", keywords: ["shell"]),
    .init(value: "open power shell", label: "open power shell", category: "Apps", keywords: ["powershell", "shell"]),
    .init(value: "open cmd", label: "open cmd", category: "Apps", keywords: ["command prompt"]),
    .init(value: "open command prompt", label: "open command prompt", category: "Apps", keywords: ["cmd"]),
    .init(value: "open control panel", label: "open control panel", category: "Apps", keywords: ["controlpanel"]),
    .init(value: "open paint", label: "open paint", category: "Apps", keywords: ["mspaint"]),
    .init(value: "open mspaint", label: "open mspaint", category: "Apps", keywords: ["paint"]),
    .init(value: "open snipping tool", label: "open snipping tool", category: "Apps", keywords: ["snippingtool", "screenshot"]),
    .init(value: "lock", label: "lock", category: "Power", keywords: ["lock pc"]),
    .init(value: "lock pc", label: "lock pc", category: "Power", keywords: ["lock"]),
    .init(value: "sleep", label: "sleep", category: "Power", keywords: ["sleep pc"]),
    .init(value: "sleep pc", label: "sleep pc", category: "Power", keywords: ["sleep"]),
    .init(value: "shutdown", label: "shutdown", category: "Power", keywords: ["shut down", "shutdown pc"]),
    .init(value: "shut down", label: "shut down", category: "Power", keywords: ["shutdown"]),
    .init(value: "shutdown pc", label: "shutdown pc", category: "Power", keywords: ["shutdown"]),
    .init(value: "restart", label: "restart", category: "Power", keywords: ["reboot", "restart pc"]),
    .init(value: "reboot", label: "reboot", category: "Power", keywords: ["restart"]),
    .init(value: "restart pc", label: "restart pc", category: "Power", keywords: ["restart"]),
    .init(value: "notify", label: "notify (requires message)", category: "Messaging", keywords: ["alert", "notification"]),
  ]

  static let knownActionValues = Set(entries.map { $0.normalizedValue })
  static let repeatableActions: Set<String> = [
    "volume up",
    "vol up",
    "louder",
    "volume higher",
    "volume down",
    "vol down",
    "quieter",
    "volume lower",
    "next track",
    "skip track",
    "next",
    "skip",
    "previous track",
    "previous",
    "prev",
    "back",
  ]
  static let dangerousActions: Set<String> = [
    "shutdown",
    "shut down",
    "shutdown pc",
    "restart",
    "reboot",
    "restart pc",
    "sleep",
    "sleep pc",
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
    if knownActionValues.contains(normalized) {
      return normalized
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
  static let jarvis: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateStyle = .short
    formatter.timeStyle = .medium
    return formatter
  }()
}
