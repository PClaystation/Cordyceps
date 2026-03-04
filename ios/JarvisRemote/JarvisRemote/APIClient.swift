import Foundation

enum JarvisClientError: LocalizedError {
  case missingToken
  case invalidBaseURL
  case invalidResponse
  case httpError(status: Int, message: String)
  case decodingFailed

  var errorDescription: String? {
    switch self {
    case .missingToken:
      return "Set PHONE_API_TOKEN first."
    case .invalidBaseURL:
      return "Set a valid API base URL, for example https://your-server.example"
    case .invalidResponse:
      return "Server returned an invalid response."
    case let .httpError(status, message):
      return "HTTP \(status): \(message)"
    case .decodingFailed:
      return "Could not decode server response."
    }
  }
}

struct ConnectionConfig {
  let baseURL: URL
  let token: String
}

enum JarvisClient {
  private static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return encoder
  }()

  private static let decoder = JSONDecoder()

  static func makeConnectionConfig(apiBaseInput: String, tokenInput: String) throws -> ConnectionConfig {
    let token = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
    if token.isEmpty {
      throw JarvisClientError.missingToken
    }

    guard let baseURL = normalizeBaseURL(from: apiBaseInput) else {
      throw JarvisClientError.invalidBaseURL
    }

    return ConnectionConfig(baseURL: baseURL, token: token)
  }

  static func loadDevices(config: ConnectionConfig) async throws -> APIResponse<DevicesResponse> {
    try await execute(
      config: config,
      path: "/api/devices",
      method: "GET",
      body: Optional<CommandRequest>.none,
      responseType: DevicesResponse.self
    )
  }

  static func sendCommand(config: ConnectionConfig, text: String) async throws -> APIResponse<CommandResponse> {
    let requestID = requestID(prefix: "ios")
    let payload = CommandRequest(
      request_id: requestID,
      text: text,
      source: "ios-native",
      sent_at: ISO8601DateFormatter().string(from: Date()),
      client_version: "jarvis-remote-ios-v2"
    )

    return try await execute(
      config: config,
      path: "/api/command",
      method: "POST",
      body: payload,
      responseType: CommandResponse.self
    )
  }

  static func pushUpdate(
    config: ConnectionConfig,
    target: String,
    version: String,
    packageURL: String,
    sha256: String?,
    sizeBytes: Int?
  ) async throws -> APIResponse<UpdateResponse> {
    let requestID = requestID(prefix: "ios-update")
    let payload = UpdateRequest(
      request_id: requestID,
      source: "ios-native",
      target: target,
      version: version,
      package_url: packageURL,
      sha256: sha256,
      size_bytes: sizeBytes
    )

    return try await execute(
      config: config,
      path: "/api/update",
      method: "POST",
      body: payload,
      responseType: UpdateResponse.self
    )
  }

  private static func execute<RequestBody: Encodable, ResponseBody: Decodable>(
    config: ConnectionConfig,
    path: String,
    method: String,
    body: RequestBody?,
    responseType: ResponseBody.Type
  ) async throws -> APIResponse<ResponseBody> {
    guard let endpointURL = buildURL(baseURL: config.baseURL, path: path) else {
      throw JarvisClientError.invalidBaseURL
    }

    var request = URLRequest(url: endpointURL)
    request.httpMethod = method
    request.timeoutInterval = 20
    request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")

    if let body {
      request.httpBody = try encoder.encode(body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let data: Data
    let response: URLResponse
    let startTime = Date()

    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw error
    }

    guard let http = response as? HTTPURLResponse else {
      throw JarvisClientError.invalidResponse
    }

    let latencyMs = Date().timeIntervalSince(startTime) * 1000

    if !(200 ... 299).contains(http.statusCode) {
      let message = parseErrorMessage(from: data) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
      throw JarvisClientError.httpError(status: http.statusCode, message: message)
    }

    guard let decoded = try? decoder.decode(responseType, from: data) else {
      throw JarvisClientError.decodingFailed
    }

    return APIResponse(
      body: decoded,
      rawJSON: prettyJSON(from: data),
      latencyMs: latencyMs,
      statusCode: http.statusCode
    )
  }

  private static func buildURL(baseURL: URL, path: String) -> URL? {
    var base = baseURL.absoluteString
    while base.hasSuffix("/") {
      base.removeLast()
    }

    let normalizedPath: String
    if path.hasPrefix("/") {
      normalizedPath = path
    } else {
      normalizedPath = "/\(path)"
    }

    return URL(string: base + normalizedPath)
  }

  private static func parseErrorMessage(from data: Data) -> String? {
    guard let decoded = try? decoder.decode(ErrorResponse.self, from: data) else {
      return prettyJSON(from: data)
    }

    if let message = decoded.message, !message.isEmpty {
      return message
    }

    if let error = decoded.error, !error.isEmpty {
      return error
    }

    return decoded.error_code
  }

  static func normalizeBaseURL(from input: String) -> URL? {
    let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty {
      return nil
    }

    let wsMapped = raw
      .replacingOccurrences(
        of: #"^wss://"#,
        with: "https://",
        options: [.regularExpression, .caseInsensitive]
      )
      .replacingOccurrences(
        of: #"^ws://"#,
        with: "http://",
        options: [.regularExpression, .caseInsensitive]
      )

    let candidate: String
    if wsMapped.contains("://") {
      candidate = wsMapped
    } else {
      candidate = "https://\(wsMapped)"
    }

    guard var components = URLComponents(string: candidate),
          let scheme = components.scheme?.lowercased(),
          ["http", "https"].contains(scheme)
    else {
      return nil
    }

    if components.user != nil || components.password != nil {
      return nil
    }

    components.path = ""
    components.query = nil
    components.fragment = nil

    if components.host == nil {
      return nil
    }

    return components.url
  }

  static func requestID(prefix: String) -> String {
    let millis = Int(Date().timeIntervalSince1970 * 1000)
    let suffix = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8)
    return "\(prefix)-\(millis)-\(suffix)"
  }

  static func prettyJSON(from data: Data) -> String {
    guard let object = try? JSONSerialization.jsonObject(with: data),
          let prettyData = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted]),
          let string = String(data: prettyData, encoding: .utf8)
    else {
      return String(data: data, encoding: .utf8) ?? "(no response body)"
    }

    return string
  }
}
