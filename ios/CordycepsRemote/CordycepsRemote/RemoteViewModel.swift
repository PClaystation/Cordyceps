import AVFoundation
import Foundation
import Speech
import UIKit

@MainActor
final class RemoteViewModel: ObservableObject {
  private enum DefaultsKey {
    static let apiBase = "cordyceps.ios.apiBase"
    static let token = "cordyceps.ios.phoneToken"
    static let target = "cordyceps.ios.target"
    static let updateTarget = "cordyceps.ios.updateTarget"
    static let updateVersion = "cordyceps.ios.updateVersion"
    static let updateURL = "cordyceps.ios.updateURL"
    static let updateSha = "cordyceps.ios.updateSha"
    static let updateSize = "cordyceps.ios.updateSize"
    static let lastSuccess = "cordyceps.ios.lastSuccess"
    static let lastAction = "cordyceps.ios.lastAction"
    static let commandHistory = "cordyceps.ios.commandHistory"
  }

  private static let pollIntervalNs: UInt64 = 30_000_000_000
  private static let maxCommandHistory = 12

  @Published var apiBaseInput: String
  @Published var tokenInput: String
  @Published var targetInput: String

  @Published var actionSearchInput = ""
  @Published var selectedActionValue: String
  @Published var argumentInput = ""
  @Published var commandText = ""

  @Published var updateTargetInput: String
  @Published var updateVersionInput: String
  @Published var updateURLInput: String
  @Published var updateShaInput: String
  @Published var updateSizeInput: String

  @Published var pairingLinkInput = ""
  @Published var deviceSearchInput = ""
  @Published var showOnlyOnlineDevices = false

  @Published var devices: [DeviceRecord] = []
  @Published var recentCommands: [String]

  @Published var isLoadingDevices = false
  @Published var isTestingToken = false
  @Published var isSendingCommand = false
  @Published var isPushingUpdate = false

  @Published var connectionState: ConnectionState
  @Published var statusText = "Set API base URL and PHONE_API_TOKEN, then load devices."
  @Published var statusIsError = false
  @Published var lastSuccessLabel = "Last success: never"

  @Published var resultStatus = "idle"
  @Published var resultRequestId = "-"
  @Published var resultLatency = "-"
  @Published var resultMessage = "No request yet."
  @Published var responseText = "No request yet."
  @Published var resultIsError = false

  @Published var speechInfoText = "Speech: tap Speak to dictate a command."
  @Published var speechSupported = true
  @Published var isListening = false

  private let defaults = UserDefaults.standard
  private let speechController = SpeechController()
  private var pollingTask: Task<Void, Never>?
  private var hasInitialized = false
  private var appIsActive = true

  init() {
    let initialTarget = defaults.string(forKey: DefaultsKey.target) ?? "m1"
    let rememberedAction = defaults.string(forKey: DefaultsKey.lastAction) ?? "ping"
    let initialToken = defaults.string(forKey: DefaultsKey.token) ?? ""

    apiBaseInput = defaults.string(forKey: DefaultsKey.apiBase) ?? ""
    tokenInput = initialToken
    targetInput = initialTarget

    selectedActionValue = CommandLibrary.safeAction(rememberedAction)

    updateTargetInput = defaults.string(forKey: DefaultsKey.updateTarget) ?? initialTarget
    updateVersionInput = defaults.string(forKey: DefaultsKey.updateVersion) ?? ""
    updateURLInput = defaults.string(forKey: DefaultsKey.updateURL) ?? ""
    updateShaInput = defaults.string(forKey: DefaultsKey.updateSha) ?? ""
    updateSizeInput = defaults.string(forKey: DefaultsKey.updateSize) ?? ""
    recentCommands = []

    connectionState = initialToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .disconnected : .retrying

    if let lastSuccess = defaults.string(forKey: DefaultsKey.lastSuccess) {
      lastSuccessLabel = "Last success: \(toLocalTimestamp(lastSuccess))"
    }

    commandText = composeCommand()
    speechSupported = speechController.isAvailable
    if !speechSupported {
      speechInfoText = "Speech not supported on this device."
    }

    recentCommands = loadCommandHistory()
  }

  deinit {
    pollingTask?.cancel()
    speechController.stop()
  }

  var selectedAction: CommandLibraryEntry {
    CommandLibrary.entry(for: selectedActionValue) ?? CommandLibrary.entry(for: "ping")!
  }

  var filteredActions: [CommandLibraryEntry] {
    CommandLibrary.filteredEntries(matching: actionSearchInput)
  }

  var filteredDevices: [DeviceRecord] {
    var filtered = devices

    if showOnlyOnlineDevices {
      filtered = filtered.filter(\.isOnline)
    }

    let query = deviceSearchInput.normalizedActionText
    if query.isEmpty {
      return filtered
    }

    let terms = query.split(separator: " ").map(String.init)
    return filtered.filter { device in
      let searchable = [
        device.device_id,
        device.display_name ?? "",
        device.hostname ?? "",
        device.username ?? "",
      ]
      .joined(separator: " ")
      .normalizedActionText

      return terms.allSatisfy { term in
        searchable.contains(term)
      }
    }
  }

  var actionPickerGroups: [CommandCategoryGroup] {
    let filtered = filteredActions
    if filtered.isEmpty {
      return CommandLibrary.grouped(entries: CommandLibrary.entries)
    }
    return CommandLibrary.grouped(entries: filtered)
  }

  var actionSearchInfo: String {
    if actionSearchInput.normalizedActionText.isEmpty {
      return "Showing all \(CommandLibrary.entries.count) commands."
    }

    if filteredActions.isEmpty {
      return "No matches for \"\(actionSearchInput.normalizedActionText)\"."
    }

    return "Showing \(filteredActions.count) of \(CommandLibrary.entries.count) commands."
  }

  var selectedActionIsDangerous: Bool {
    selectedAction.isDangerous
  }

  var selectedActionUsesArgument: Bool {
    selectedAction.usesArgument
  }

  var selectedActionArgumentPlaceholder: String {
    selectedAction.placeholderArgument
  }

  var deviceSummaryText: String {
    guard !devices.isEmpty else {
      return "No data yet"
    }

    let onlineCount = devices.filter(\.isOnline).count
    if filteredDevices.count != devices.count {
      return "\(onlineCount)/\(devices.count) online • \(filteredDevices.count) shown"
    }
    return "\(onlineCount)/\(devices.count) online"
  }

  func handleInitialLoad() async {
    guard !hasInitialized else {
      return
    }

    hasInitialized = true
    startPollingIfNeeded()

    guard !tokenInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return
    }

    await loadDevices(silent: true, fromPolling: false)
    if responseText == "No request yet." {
      setResult(message: "Devices loaded.", rawBody: "Devices loaded.", isError: false)
    }
  }

  func setAppLifecycle(isActive: Bool) {
    appIsActive = isActive
    if !isActive {
      pollingTask?.cancel()
      pollingTask = nil
      if isListening {
        speechController.stop()
        isListening = false
        speechInfoText = "Speech paused while app is in background."
      }
      return
    }

    startPollingIfNeeded()
  }

  func saveConnectionSettings() {
    let normalizedBase = CordycepsClient.normalizeBaseURL(from: apiBaseInput)?.absoluteString ?? apiBaseInput.trimmed
    let token = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
    let target = normalizeTarget(targetInput)

    apiBaseInput = normalizedBase
    tokenInput = token
    targetInput = target

    defaults.set(normalizedBase, forKey: DefaultsKey.apiBase)
    defaults.set(token, forKey: DefaultsKey.token)
    defaults.set(target, forKey: DefaultsKey.target)

    if updateTargetInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      updateTargetInput = target
      defaults.set(updateTargetInput, forKey: DefaultsKey.updateTarget)
    }

    connectionState = token.isEmpty ? .disconnected : .retrying
    commandText = composeCommand()
    startPollingIfNeeded()
    setStatus("Connection settings saved.", isError: false)
    setResult(message: "Connection settings saved on this device.", rawBody: "Connection settings saved on this device.", isError: false)
  }

  func persistUpdateSettings() {
    let target = normalizeExplicitTarget(updateTargetInput)
    let version = updateVersionInput.trimmingCharacters(in: .whitespacesAndNewlines)
    let url = updateURLInput.trimmingCharacters(in: .whitespacesAndNewlines)
    let sha = updateShaInput.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let size = updateSizeInput.trimmingCharacters(in: .whitespacesAndNewlines)

    updateTargetInput = target
    updateVersionInput = version
    updateURLInput = url
    updateShaInput = sha
    updateSizeInput = size

    defaults.set(target, forKey: DefaultsKey.updateTarget)
    defaults.set(version, forKey: DefaultsKey.updateVersion)
    defaults.set(url, forKey: DefaultsKey.updateURL)
    defaults.set(sha, forKey: DefaultsKey.updateSha)
    defaults.set(size, forKey: DefaultsKey.updateSize)
  }

  func targetDidChange() {
    let normalized = normalizeTarget(targetInput)
    if normalized != targetInput {
      targetInput = normalized
    }

    defaults.set(normalized, forKey: DefaultsKey.target)
    if updateTargetInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      updateTargetInput = normalized
    }
    composeFromInputs()
  }

  func actionSearchDidChange() {
    if filteredActions.isEmpty {
      return
    }

    let normalizedSelected = selectedActionValue.normalizedActionText
    let exists = filteredActions.contains(where: { $0.normalizedValue == normalizedSelected })
    if !exists, let fallback = filteredActions.first {
      selectedActionValue = fallback.normalizedValue
      defaults.set(selectedActionValue, forKey: DefaultsKey.lastAction)
    }

    composeFromInputs()
  }

  func actionSelectionDidChange() {
    selectedActionValue = CommandLibrary.safeAction(selectedActionValue)
    defaults.set(selectedActionValue, forKey: DefaultsKey.lastAction)
    composeFromInputs()
  }

  func composeFromInputs() {
    commandText = composeCommand()
  }

  func setAction(_ actionValue: String) {
    selectedActionValue = CommandLibrary.safeAction(actionValue)
    defaults.set(selectedActionValue, forKey: DefaultsKey.lastAction)
    composeFromInputs()
  }

  func useDeviceAsTarget(_ deviceID: String) {
    let normalized = normalizeExplicitTarget(deviceID)
    guard !normalized.isEmpty else {
      return
    }

    targetInput = normalized
    updateTargetInput = normalized
    defaults.set(normalized, forKey: DefaultsKey.target)
    defaults.set(normalized, forKey: DefaultsKey.updateTarget)
    commandText = composeCommand()
    setStatus("Target set to \(normalized).", isError: false)
    setResult(message: "Target set to \(normalized).", rawBody: "Target set to \(normalized).", isError: false)
  }

  func loadDevices(silent: Bool = false, fromPolling: Bool = false) async {
    if isLoadingDevices {
      return
    }

    isLoadingDevices = true
    defer { isLoadingDevices = false }

    do {
      let config = try CordycepsClient.makeConnectionConfig(apiBaseInput: apiBaseInput, tokenInput: tokenInput)
      let response = try await CordycepsClient.loadDevices(config: config)
      devices = sortedDevices(response.body.devices)
      connectionState = .connected

      if !silent {
        setStatus("Loaded \(devices.count) devices.", isError: false)
        setResult(
          message: "Devices loaded.",
          rawBody: response.rawJSON,
          requestID: "-",
          latencyMs: response.latencyMs,
          isError: false
        )
        triggerFeedback(.success)
      }
    } catch {
      handle(error: error, silent: silent, fromPolling: fromPolling)
    }
  }

  func testToken() async {
    guard !isTestingToken else {
      return
    }

    isTestingToken = true
    defer { isTestingToken = false }

    setStatus("Testing token...", isError: false)

    do {
      let config = try CordycepsClient.makeConnectionConfig(apiBaseInput: apiBaseInput, tokenInput: tokenInput)
      let response = try await CordycepsClient.loadDevices(config: config)
      devices = sortedDevices(response.body.devices)
      connectionState = .connected
      setStatus("Token valid. Device list loaded.", isError: false)
      setResult(
        message: "Token test passed.",
        rawBody: "Token test passed.",
        requestID: "-",
        latencyMs: response.latencyMs,
        isError: false
      )
      triggerFeedback(.success)
      startPollingIfNeeded()
    } catch {
      handle(error: error, silent: false, fromPolling: false)
    }
  }

  func sendCommand() async {
    let text = commandText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      setStatus("Command text is empty.", isError: true)
      setResult(message: "Command text is empty.", rawBody: "Command text is empty.", isError: true)
      return
    }

    guard !isSendingCommand else {
      return
    }

    isSendingCommand = true
    defer { isSendingCommand = false }

    do {
      let config = try CordycepsClient.makeConnectionConfig(apiBaseInput: apiBaseInput, tokenInput: tokenInput)
      let response = try await CordycepsClient.sendCommand(config: config, text: text)
      connectionState = .connected

      let isError = response.body.ok == false
      let message = response.body.message ?? response.body.error_code ?? (isError ? "Command failed." : "Command sent.")
      if !isError {
        setLastCommandSuccess()
        appendRecentCommand(text)
        triggerFeedback(.success)
      } else {
        triggerFeedback(.error)
      }
      setStatus(message, isError: isError)
      setResult(
        message: message,
        rawBody: response.rawJSON,
        requestID: response.body.request_id ?? "-",
        latencyMs: response.latencyMs,
        isError: isError
      )
    } catch {
      handle(error: error, silent: false, fromPolling: false)
    }
  }

  func pushUpdate() async {
    guard !isPushingUpdate else {
      return
    }

    persistUpdateSettings()

    let target = normalizeExplicitTarget(updateTargetInput)
    let version = updateVersionInput
    let packageURL = updateURLInput
    let sha = updateShaInput.isEmpty ? nil : updateShaInput

    guard !target.isEmpty else {
      setStatus("Update target is required.", isError: true)
      setResult(message: "Update target is required.", rawBody: "Update target is required.", isError: true)
      return
    }

    guard !version.isEmpty else {
      setStatus("Update version is required.", isError: true)
      setResult(message: "Update version is required.", rawBody: "Update version is required.", isError: true)
      return
    }

    guard !packageURL.isEmpty else {
      setStatus("Update package URL is required.", isError: true)
      setResult(message: "Update package URL is required.", rawBody: "Update package URL is required.", isError: true)
      return
    }

    guard isValidAbsoluteUpdateURL(packageURL) else {
      setStatus("Update package URL must be an absolute http/https URL.", isError: true)
      setResult(
        message: "Update package URL must be an absolute http/https URL.",
        rawBody: "Update package URL must be an absolute http/https URL.",
        isError: true
      )
      return
    }

    if let sha, !isValidSHA256(sha) {
      setStatus("SHA256 must be a 64-character hex string.", isError: true)
      setResult(message: "SHA256 must be a 64-character hex string.", rawBody: "SHA256 must be a 64-character hex string.", isError: true)
      return
    }

    let sizeBytes: Int?
    if updateSizeInput.isEmpty {
      sizeBytes = nil
    } else if let parsed = Int(updateSizeInput), parsed > 0 {
      sizeBytes = parsed
    } else {
      setStatus("Update size must be a positive integer.", isError: true)
      setResult(message: "Update size must be a positive integer.", rawBody: "Update size must be a positive integer.", isError: true)
      return
    }

    isPushingUpdate = true
    defer { isPushingUpdate = false }

    do {
      let config = try CordycepsClient.makeConnectionConfig(apiBaseInput: apiBaseInput, tokenInput: tokenInput)
      let response = try await CordycepsClient.pushUpdate(
        config: config,
        target: target,
        version: version,
        packageURL: packageURL,
        sha256: sha,
        sizeBytes: sizeBytes
      )

      connectionState = .connected
      let isError = response.body.ok == false
      let message = response.body.message ?? response.body.error_code ?? (isError ? "Update failed." : "Update dispatched.")
      if isError {
        triggerFeedback(.error)
      } else {
        triggerFeedback(.success)
      }
      setStatus(message, isError: isError)
      setResult(
        message: message,
        rawBody: response.rawJSON,
        requestID: response.body.request_id ?? "-",
        latencyMs: response.latencyMs,
        isError: isError
      )
    } catch {
      handle(error: error, silent: false, fromPolling: false)
    }
  }

  func pastePairingLinkFromClipboard() {
    if let copied = UIPasteboard.general.string, !copied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      pairingLinkInput = copied
    }
  }

  func applyPairingLinkFromInput() {
    applyPairingLink(pairingLinkInput)
  }

  func applyPairingLink(_ rawLink: String) {
    let raw = rawLink.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !raw.isEmpty else {
      setStatus("Pairing link is empty.", isError: true)
      setResult(message: "Pairing link is empty.", rawBody: "Pairing link is empty.", isError: true)
      return
    }

    let parameters = parsePairingParameters(raw)
    guard !parameters.isEmpty else {
      setStatus("No pairing parameters found in the link.", isError: true)
      setResult(message: "No pairing parameters found in the link.", rawBody: "No pairing parameters found in the link.", isError: true)
      return
    }

    let read: (String) -> String = { key in
      parameters[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    let token = read("token")
    let api = read("api")
    let target = read("target")
    let action = read("action")
    let arg = read("arg")
    let command = read("command")
    let updateTarget = read("update_target")
    let updateVersion = read("update_version")
    let updateURL = read("update_url")
    let updateSha = read("update_sha")
    let updateSize = read("update_size")

    var applied = false

    if !api.isEmpty {
      let normalizedAPI = CordycepsClient.normalizeBaseURL(from: api)?.absoluteString ?? api
      apiBaseInput = normalizedAPI
      defaults.set(normalizedAPI, forKey: DefaultsKey.apiBase)
      applied = true
    }

    if !token.isEmpty {
      tokenInput = token
      defaults.set(token, forKey: DefaultsKey.token)
      applied = true
    }

    if !target.isEmpty {
      let normalizedTarget = normalizeExplicitTarget(target)
      if !normalizedTarget.isEmpty {
        targetInput = normalizedTarget
        defaults.set(normalizedTarget, forKey: DefaultsKey.target)
        applied = true
      }
    }

    if !updateTarget.isEmpty {
      let normalizedUpdateTarget = normalizeExplicitTarget(updateTarget)
      if !normalizedUpdateTarget.isEmpty {
        updateTargetInput = normalizedUpdateTarget
        defaults.set(normalizedUpdateTarget, forKey: DefaultsKey.updateTarget)
        applied = true
      }
    } else if !target.isEmpty {
      let normalizedTarget = normalizeExplicitTarget(target)
      if !normalizedTarget.isEmpty {
        updateTargetInput = normalizedTarget
        defaults.set(normalizedTarget, forKey: DefaultsKey.updateTarget)
      }
    }

    if !updateVersion.isEmpty {
      updateVersionInput = updateVersion
      defaults.set(updateVersion, forKey: DefaultsKey.updateVersion)
      applied = true
    }

    if !updateURL.isEmpty {
      updateURLInput = updateURL
      defaults.set(updateURL, forKey: DefaultsKey.updateURL)
      applied = true
    }

    if !updateSha.isEmpty {
      let sha = updateSha.lowercased()
      updateShaInput = sha
      defaults.set(sha, forKey: DefaultsKey.updateSha)
      applied = true
    }

    if !updateSize.isEmpty {
      updateSizeInput = updateSize
      defaults.set(updateSize, forKey: DefaultsKey.updateSize)
      applied = true
    }

    if !action.isEmpty {
      let normalizedAction = CommandLibrary.safeAction(action)
      selectedActionValue = normalizedAction
      defaults.set(normalizedAction, forKey: DefaultsKey.lastAction)
      applied = true
    }

    if !arg.isEmpty {
      argumentInput = arg
      applied = true
    }

    if !command.isEmpty {
      commandText = collapseWhitespacePreservingCase(command)
      applied = true
    } else if !target.isEmpty, !action.isEmpty {
      let combined = "\(target.normalizedActionText) \(action.normalizedActionText)\(arg.isEmpty ? "" : " \(arg)")"
      commandText = combined
      applied = true
    } else {
      commandText = composeCommand()
    }

    connectionState = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .disconnected : .retrying
    startPollingIfNeeded()

    if applied {
      pairingLinkInput = ""
      let message = "Connection configured from pairing link. Fields were auto-filled."
      setStatus(message, isError: false)
      setResult(message: message, rawBody: message, isError: false)
    }
  }

  func copyResponseToClipboard() {
    UIPasteboard.general.string = responseText
    setStatus("Result JSON copied.", isError: false)
    triggerFeedback(.success)
  }

  func copyCommandToClipboard() {
    let text = commandText.trimmed
    guard !text.isEmpty else {
      setStatus("Command text is empty.", isError: true)
      setResult(message: "Command text is empty.", rawBody: "Command text is empty.", isError: true)
      triggerFeedback(.error)
      return
    }

    UIPasteboard.general.string = text
    setStatus("Command copied to clipboard.", isError: false)
    triggerFeedback(.success)
  }

  func useRecentCommand(_ command: String) {
    let trimmed = command.trimmed
    guard !trimmed.isEmpty else {
      return
    }

    commandText = trimmed
    setStatus("Loaded a recent command.", isError: false)
  }

  func clearRecentCommands() {
    recentCommands = []
    defaults.removeObject(forKey: DefaultsKey.commandHistory)
    setStatus("Recent command history cleared.", isError: false)
  }

  func toggleSpeechCapture() async {
    if isListening {
      speechController.stop()
      isListening = false
      speechInfoText = "Speech stopped."
      return
    }

    guard speechController.isAvailable else {
      speechSupported = false
      speechInfoText = "Speech not supported on this device."
      setStatus(speechInfoText, isError: true)
      return
    }

    let speechAuth = await requestSpeechAuthorization()
    guard speechAuth == .authorized else {
      speechInfoText = "Speech permission denied."
      setStatus(speechInfoText, isError: true)
      setResult(message: speechInfoText, rawBody: speechInfoText, isError: true)
      return
    }

    let micGranted = await requestMicrophonePermission()
    guard micGranted else {
      speechInfoText = "Microphone permission denied."
      setStatus(speechInfoText, isError: true)
      setResult(message: speechInfoText, rawBody: speechInfoText, isError: true)
      return
    }

    do {
      try speechController.start(
        onTranscription: { [weak self] text, isFinal in
          guard let self else {
            return
          }
          Task { @MainActor in
            self.commandText = self.collapseWhitespacePreservingCase(text)
            self.speechInfoText = isFinal ? "Speech captured." : "Listening..."
            if isFinal {
              self.isListening = false
            }
          }
        },
        onError: { [weak self] message in
          guard let self else {
            return
          }
          Task { @MainActor in
            self.isListening = false
            self.speechInfoText = "Speech error: \(message)"
            self.setStatus(self.speechInfoText, isError: true)
            self.setResult(message: self.speechInfoText, rawBody: self.speechInfoText, isError: true)
          }
        }
      )
      isListening = true
      speechInfoText = "Listening..."
    } catch {
      let message = "Speech setup failed: \(error.localizedDescription)"
      isListening = false
      speechInfoText = message
      setStatus(message, isError: true)
      setResult(message: message, rawBody: message, isError: true)
    }
  }

  private func startPollingIfNeeded() {
    pollingTask?.cancel()
    pollingTask = nil

    guard appIsActive else {
      return
    }

    let token = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else {
      connectionState = .disconnected
      return
    }

    guard CordycepsClient.normalizeBaseURL(from: apiBaseInput) != nil else {
      connectionState = .retrying
      return
    }

    pollingTask = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: Self.pollIntervalNs)
        guard let self, !Task.isCancelled else {
          return
        }

        let activeToken = self.tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if activeToken.isEmpty {
          self.connectionState = .disconnected
          return
        }

        if CordycepsClient.normalizeBaseURL(from: self.apiBaseInput) == nil {
          self.connectionState = .retrying
          return
        }

        await self.loadDevices(silent: true, fromPolling: true)
      }
    }
  }

  private func composeCommand() -> String {
    let target = normalizeTarget(targetInput)
    let action = selectedActionValue.normalizedActionText
    let argument = argumentInput.trimmingCharacters(in: .whitespacesAndNewlines)

    guard !target.isEmpty, !action.isEmpty else {
      return ""
    }

    if action == "notify" {
      return argument.isEmpty ? "\(target) notify hello" : "\(target) notify \(argument)"
    }

    if action == "clipboard" || action == "copy" {
      return argument.isEmpty ? "\(target) \(action) copied from cordyceps" : "\(target) \(action) \(argument)"
    }

    if !argument.isEmpty, CommandLibrary.repeatableActions.contains(action) {
      return "\(target) \(action) \(argument)"
    }

    return "\(target) \(action)"
  }

  private func normalizeTarget(_ input: String) -> String {
    let normalized = normalizeExplicitTarget(input)
    if normalized.isEmpty {
      return "m1"
    }
    return normalized
  }

  private func normalizeExplicitTarget(_ input: String) -> String {
    let normalized = input.normalizedActionText
    guard isValidTarget(normalized) else {
      return ""
    }
    return normalized
  }

  private func isValidTarget(_ value: String) -> Bool {
    value.range(of: #"^(all|m[a-z0-9_-]{1,31})$"#, options: .regularExpression) != nil
  }

  private func isValidSHA256(_ value: String) -> Bool {
    value.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil
  }

  private func isValidAbsoluteUpdateURL(_ value: String) -> Bool {
    guard let parsed = URL(string: value), let scheme = parsed.scheme?.lowercased() else {
      return false
    }

    guard scheme == "https" || scheme == "http" else {
      return false
    }

    return parsed.host != nil
  }

  private func parsePairingParameters(_ raw: String) -> [String: String] {
    var queryValues: [String: String] = [:]
    var hashValues: [String: String] = [:]

    if let components = URLComponents(string: raw), let items = components.queryItems {
      for item in items {
        let key = item.name.lowercased()
        let value = item.value?.decodedURLValue ?? ""
        if !value.isEmpty {
          queryValues[key] = value
        }
      }
    }

    if let hashIndex = raw.firstIndex(of: "#") {
      let fragment = String(raw[raw.index(after: hashIndex)...])
      if !fragment.isEmpty,
         let hashComponents = URLComponents(string: "https://cordyceps.invalid/?\(fragment)"),
         let items = hashComponents.queryItems
      {
        for item in items {
          let key = item.name.lowercased()
          let value = item.value?.decodedURLValue ?? ""
          if !value.isEmpty {
            hashValues[key] = value
          }
        }
      }
    }

    var merged = queryValues
    for (key, value) in hashValues {
      merged[key] = value
    }

    return merged
  }

  private func sortedDevices(_ input: [DeviceRecord]) -> [DeviceRecord] {
    input.sorted { lhs, rhs in
      if lhs.isOnline != rhs.isOnline {
        return lhs.isOnline && !rhs.isOnline
      }
      return lhs.displayTitle.localizedCaseInsensitiveCompare(rhs.displayTitle) == .orderedAscending
    }
  }

  private func collapseWhitespacePreservingCase(_ input: String) -> String {
    input
      .trimmed
      .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
  }

  private func appendRecentCommand(_ command: String) {
    let normalized = collapseWhitespacePreservingCase(command)
    guard !normalized.isEmpty else {
      return
    }

    recentCommands.removeAll { $0 == normalized }
    recentCommands.insert(normalized, at: 0)
    if recentCommands.count > Self.maxCommandHistory {
      recentCommands = Array(recentCommands.prefix(Self.maxCommandHistory))
    }
    persistCommandHistory()
  }

  private func loadCommandHistory() -> [String] {
    guard let payload = defaults.array(forKey: DefaultsKey.commandHistory) as? [String] else {
      return []
    }
    return payload
      .map { collapseWhitespacePreservingCase($0) }
      .filter { !$0.isEmpty }
  }

  private func persistCommandHistory() {
    defaults.set(Array(recentCommands.prefix(Self.maxCommandHistory)), forKey: DefaultsKey.commandHistory)
  }

  private func setLastCommandSuccess() {
    let nowISO = ISO8601DateFormatter().string(from: Date())
    defaults.set(nowISO, forKey: DefaultsKey.lastSuccess)
    lastSuccessLabel = "Last success: \(toLocalTimestamp(nowISO))"
  }

  private func toLocalTimestamp(_ isoString: String) -> String {
    guard let date = ISO8601DateFormatter().date(from: isoString) else {
      return "never"
    }
    return DateFormatter.cordyceps.string(from: date)
  }

  private func setStatus(_ text: String, isError: Bool) {
    statusText = text
    statusIsError = isError
  }

  private func setResult(
    message: String,
    rawBody: String,
    requestID: String = "-",
    latencyMs: Double? = nil,
    isError: Bool
  ) {
    resultStatus = isError ? "error" : "ok"
    resultRequestId = requestID
    resultLatency = latencyMs.map { "\(Int($0.rounded())) ms" } ?? "-"
    resultMessage = message
    responseText = rawBody
    resultIsError = isError
  }

  private func handle(error: Error, silent: Bool, fromPolling: Bool) {
    let message: String
    var shouldDisconnect = false

    if let clientError = error as? CordycepsClientError {
      switch clientError {
      case .missingToken:
        shouldDisconnect = true
        message = clientError.localizedDescription
      case let .httpError(status, serverMessage):
        shouldDisconnect = status == 401 || status == 403
        if status == 401 || status == 403 {
          message = "Authentication failed. Check PHONE_API_TOKEN and save again."
        } else if status == 404 {
          message = "API endpoint not found. Verify API base URL."
        } else {
          message = serverMessage
        }
      default:
        message = clientError.localizedDescription
      }
    } else if let urlError = error as? URLError {
      if urlError.code == .appTransportSecurityRequiresSecureConnection {
        message = "Blocked by iOS security policy. Use an https API URL, not plain http."
      } else {
        message = "Cannot reach server. Connection is retrying (\(urlError.localizedDescription))."
      }
    } else {
      message = error.localizedDescription
    }

    connectionState = shouldDisconnect ? .disconnected : .retrying

    if silent {
      if fromPolling && !shouldDisconnect {
        connectionState = .retrying
      }
      return
    }

    setStatus(message, isError: true)
    setResult(message: message, rawBody: message, isError: true)
    triggerFeedback(.error)
  }

  private func triggerFeedback(_ type: UINotificationFeedbackGenerator.FeedbackType) {
    let feedback = UINotificationFeedbackGenerator()
    feedback.prepare()
    feedback.notificationOccurred(type)
  }

  private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
  }

  private func requestMicrophonePermission() async -> Bool {
    await withCheckedContinuation { continuation in
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
          continuation.resume(returning: granted)
        }
      }
    }
  }
}

private final class SpeechController {
  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  var isAvailable: Bool {
    recognizer != nil
  }

  func start(
    onTranscription: @escaping (_ text: String, _ isFinal: Bool) -> Void,
    onError: @escaping (_ message: String) -> Void
  ) throws {
    guard let recognizer, recognizer.isAvailable else {
      throw NSError(domain: "CordycepsSpeech", code: 1, userInfo: [NSLocalizedDescriptionKey: "Speech recognizer is unavailable."])
    }

    stop()

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    self.request = request

    let inputNode = audioEngine.inputNode
    inputNode.removeTap(onBus: 0)

    let format = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
    }

    audioEngine.prepare()
    try audioEngine.start()

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      if let result {
        onTranscription(result.bestTranscription.formattedString, result.isFinal)
        if result.isFinal {
          self?.stop()
        }
      }

      if let error {
        onError(error.localizedDescription)
        self?.stop()
      }
    }
  }

  func stop() {
    if audioEngine.isRunning {
      audioEngine.stop()
      audioEngine.inputNode.removeTap(onBus: 0)
    }

    request?.endAudio()
    request = nil

    task?.cancel()
    task = nil

    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}
