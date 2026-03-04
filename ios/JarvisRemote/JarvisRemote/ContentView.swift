import SwiftUI

struct ContentView: View {
  @StateObject private var viewModel = RemoteViewModel()

  var body: some View {
    NavigationStack {
      ZStack {
        backgroundLayer

        ScrollView {
          VStack(spacing: 18) {
            heroCard
            connectionCard
            devicesCard
            commandCard
            updateCard
            resultCard
          }
          .padding(.horizontal, 16)
          .padding(.top, 10)
          .padding(.bottom, 28)
        }
      }
      .navigationTitle("Jarvis Remote")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          if viewModel.isLoadingDevices {
            ProgressView()
          } else {
            Button {
              Task { await viewModel.loadDevices() }
            } label: {
              Label("Refresh", systemImage: "arrow.clockwise")
            }
          }
        }
      }
      .task {
        await viewModel.handleInitialLoad()
      }
      .onOpenURL { url in
        viewModel.applyPairingLink(url.absoluteString)
      }
    }
  }

  private var backgroundLayer: some View {
    ZStack {
      LinearGradient(
        colors: [Color(red: 0.03, green: 0.07, blue: 0.10), Color(red: 0.05, green: 0.13, blue: 0.18)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .ignoresSafeArea()

      Circle()
        .fill(
          RadialGradient(
            colors: [Color(red: 0.13, green: 0.51, blue: 0.44).opacity(0.35), .clear],
            center: .center,
            startRadius: 8,
            endRadius: 250
          )
        )
        .frame(width: 320, height: 320)
        .offset(x: -120, y: -260)
        .blur(radius: 6)

      Circle()
        .fill(
          RadialGradient(
            colors: [Color(red: 0.97, green: 0.72, blue: 0.27).opacity(0.30), .clear],
            center: .center,
            startRadius: 8,
            endRadius: 250
          )
        )
        .frame(width: 330, height: 330)
        .offset(x: 170, y: -310)
        .blur(radius: 7)
    }
  }

  private var heroCard: some View {
    JarvisCard(
      tint: LinearGradient(
        colors: [Color(red: 0.12, green: 0.47, blue: 0.41).opacity(0.38), Color(red: 0.90, green: 0.66, blue: 0.20).opacity(0.28)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    ) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 6) {
            Text("Command center for your fleet")
              .font(.system(.title3, design: .rounded).weight(.semibold))
              .foregroundStyle(.white)
            Text("Native iOS control surface with PWA feature parity, live status, and update dispatch.")
              .font(.system(.footnote, design: .rounded))
              .foregroundStyle(Color.white.opacity(0.78))
          }

          Spacer(minLength: 0)

          statusBadge
        }

        Text(viewModel.lastSuccessLabel)
          .font(.system(.caption, design: .rounded).weight(.medium))
          .foregroundStyle(Color.white.opacity(0.76))
      }
    }
  }

  private var connectionCard: some View {
    JarvisCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Connection")

        TextField("https://mpmc.ddns.net", text: $viewModel.apiBaseInput)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
          .autocorrectionDisabled()
          .jarvisFieldStyle()

        SecureField("PHONE_API_TOKEN", text: $viewModel.tokenInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()

        TextField("Default target (m1)", text: $viewModel.targetInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.targetInput) { _, _ in
            viewModel.targetDidChange()
          }

        VStack(spacing: 8) {
          HStack(spacing: 8) {
            actionButton("Save", icon: "checkmark.circle.fill", role: .normal) {
              viewModel.saveConnectionSettings()
            }
            actionButton("Test Token", icon: "shield.checkered", role: .normal, loading: viewModel.isTestingToken) {
              Task { await viewModel.testToken() }
            }
          }

          HStack(spacing: 8) {
            actionButton("Load Devices", icon: "rectangle.3.group.bubble.left", role: .normal, loading: viewModel.isLoadingDevices) {
              Task { await viewModel.loadDevices() }
            }
            Text(viewModel.deviceSummaryText)
              .font(.system(.caption, design: .rounded).weight(.semibold))
              .foregroundStyle(Color.white.opacity(0.70))
              .frame(maxWidth: .infinity, alignment: .trailing)
          }
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("Pairing Link")
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .foregroundStyle(Color.white.opacity(0.72))

          TextField("Paste pwa_pairing_url or external pairing link", text: $viewModel.pairingLinkInput)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
            .autocorrectionDisabled()
            .jarvisFieldStyle()

          HStack(spacing: 8) {
            actionButton("Paste", icon: "doc.on.clipboard", role: .normal) {
              viewModel.pastePairingLinkFromClipboard()
            }
            actionButton("Apply Link", icon: "link.badge.plus", role: .normal) {
              viewModel.applyPairingLinkFromInput()
            }
          }
        }

        Text(viewModel.statusText)
          .font(.system(.caption, design: .rounded).weight(.medium))
          .foregroundStyle(viewModel.statusIsError ? Color(red: 1.0, green: 0.74, blue: 0.74) : Color.white.opacity(0.72))
      }
    }
  }

  private var devicesCard: some View {
    JarvisCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Devices")

        if viewModel.devices.isEmpty {
          emptyState("No enrolled devices loaded yet.")
        } else {
          ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 10) {
              ForEach(viewModel.devices) { device in
                deviceCard(device)
              }
            }
            .padding(.vertical, 2)
          }
        }
      }
    }
  }

  private func deviceCard(_ device: DeviceRecord) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(device.device_id)
        .font(.system(.headline, design: .rounded).weight(.bold))
        .foregroundStyle(.white)
        .lineLimit(1)

      HStack(spacing: 8) {
        Capsule()
          .fill(device.isOnline ? Color(red: 0.48, green: 0.92, blue: 0.83) : Color(red: 0.84, green: 0.35, blue: 0.35))
          .frame(width: 8, height: 8)
        Text(device.isOnline ? "online" : "offline")
          .font(.system(.caption, design: .rounded).weight(.semibold))
          .foregroundStyle(device.isOnline ? Color(red: 0.48, green: 0.92, blue: 0.83) : Color(red: 0.96, green: 0.66, blue: 0.66))
      }

      Text("last seen \(device.lastSeenLabel)")
        .font(.system(.caption2, design: .rounded))
        .foregroundStyle(Color.white.opacity(0.65))

      if let version = device.version, !version.isEmpty {
        Text("v\(version)")
          .font(.system(.caption2, design: .rounded).weight(.medium))
          .foregroundStyle(Color.white.opacity(0.62))
      }

      Spacer(minLength: 0)

      Button {
        viewModel.useDeviceAsTarget(device.device_id)
      } label: {
        Text("Use Device")
          .font(.system(.caption, design: .rounded).weight(.bold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(device.isOnline ? Color(red: 0.20, green: 0.70, blue: 0.60) : Color(red: 0.35, green: 0.37, blue: 0.42))
    }
    .padding(12)
    .frame(width: 180, height: 152, alignment: .topLeading)
    .background(
      RoundedRectangle(cornerRadius: 15, style: .continuous)
        .fill(Color.white.opacity(0.05))
        .overlay(
          RoundedRectangle(cornerRadius: 15, style: .continuous)
            .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    )
  }

  private var commandCard: some View {
    JarvisCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Command")

        TextField("Target (m1 or all)", text: $viewModel.targetInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.targetInput) { _, _ in
            viewModel.targetDidChange()
          }

        TextField("Search commands, aliases, and apps", text: $viewModel.actionSearchInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.actionSearchInput) { _, _ in
            viewModel.actionSearchDidChange()
          }

        Picker("Action", selection: $viewModel.selectedActionValue) {
          ForEach(viewModel.actionPickerGroups) { group in
            Section(group.category) {
              ForEach(group.entries) { entry in
                Text(entry.label).tag(entry.value)
              }
            }
          }
        }
        .pickerStyle(.menu)
        .tint(Color(red: 0.52, green: 0.90, blue: 0.82))
        .onChange(of: viewModel.selectedActionValue) { _, _ in
          viewModel.actionSelectionDidChange()
        }

        Text(viewModel.actionSearchInfo)
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.70))

        if viewModel.selectedActionUsesArgument {
          TextField(viewModel.selectedActionArgumentPlaceholder, text: $viewModel.argumentInput)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .jarvisFieldStyle()
            .onChange(of: viewModel.argumentInput) { _, _ in
              viewModel.composeFromInputs()
            }
        }

        if viewModel.selectedActionIsDangerous {
          dangerZone("This command can interrupt the machine immediately. Confirm the target before sending.")
        }

        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(CommandLibrary.quickActions, id: \.self) { action in
              Button(action) {
                viewModel.argumentInput = ""
                viewModel.setAction(action)
              }
              .font(.system(.caption, design: .rounded).weight(.semibold))
              .padding(.horizontal, 12)
              .padding(.vertical, 7)
              .background(
                Capsule()
                  .fill(Color.white.opacity(0.08))
                  .overlay(Capsule().stroke(Color.white.opacity(0.16), lineWidth: 1))
              )
              .foregroundStyle(Color.white.opacity(0.88))
            }
          }
          .padding(.vertical, 2)
        }

        TextField("Command text", text: $viewModel.commandText, axis: .vertical)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .lineLimit(2 ... 6)
          .jarvisFieldStyle()

        HStack(spacing: 8) {
          actionButton("Build", icon: "wand.and.stars", role: .normal) {
            viewModel.composeFromInputs()
          }

          actionButton(
            viewModel.isListening ? "Stop" : "Speak",
            icon: viewModel.isListening ? "waveform.slash" : "waveform",
            role: .normal
          ) {
            Task { await viewModel.toggleSpeechCapture() }
          }

          actionButton("Send", icon: "paperplane.fill", role: viewModel.selectedActionIsDangerous ? .danger : .primary, loading: viewModel.isSendingCommand) {
            Task { await viewModel.sendCommand() }
          }
        }

        Text(viewModel.speechInfoText)
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(viewModel.speechSupported ? Color.white.opacity(0.70) : Color(red: 0.98, green: 0.72, blue: 0.72))
      }
    }
  }

  private var updateCard: some View {
    JarvisCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Agent Update")

        Text("Push a verified agent EXE update to one target or all online devices.")
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.72))

        dangerZone("Updates restart the agent and can break connectivity if package details are wrong.")

        TextField("Target (m1 or all)", text: $viewModel.updateTargetInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.updateTargetInput) { _, _ in viewModel.persistUpdateSettings() }

        TextField("Version (0.2.0)", text: $viewModel.updateVersionInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.updateVersionInput) { _, _ in viewModel.persistUpdateSettings() }

        TextField("Package URL (https://...)", text: $viewModel.updateURLInput)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.updateURLInput) { _, _ in viewModel.persistUpdateSettings() }

        TextField("SHA256 (optional 64 hex chars)", text: $viewModel.updateShaInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .jarvisFieldStyle()
          .onChange(of: viewModel.updateShaInput) { _, _ in viewModel.persistUpdateSettings() }

        TextField("Size bytes (optional)", text: $viewModel.updateSizeInput)
          .keyboardType(.numberPad)
          .jarvisFieldStyle()
          .onChange(of: viewModel.updateSizeInput) { _, _ in viewModel.persistUpdateSettings() }

        actionButton("Push Update", icon: "arrow.up.circle.fill", role: .warning, loading: viewModel.isPushingUpdate) {
          Task { await viewModel.pushUpdate() }
        }
      }
    }
  }

  private var resultCard: some View {
    JarvisCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Result")

        VStack(spacing: 8) {
          resultRow("Status", value: viewModel.resultStatus, emphasize: viewModel.resultIsError)
          resultRow("Request ID", value: viewModel.resultRequestId)
          resultRow("Latency", value: viewModel.resultLatency)
          resultRow("Message", value: viewModel.resultMessage, multiline: true)
        }

        ScrollView(.vertical) {
          Text(viewModel.responseText)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(Color(red: 0.89, green: 0.94, blue: 0.97))
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
        }
        .frame(minHeight: 130, maxHeight: 260)
        .padding(12)
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.black.opacity(0.28))
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.10), lineWidth: 1)
            )
        )

        actionButton("Copy Result JSON", icon: "doc.on.doc.fill", role: .normal) {
          viewModel.copyResponseToClipboard()
        }
      }
    }
  }

  private var statusBadge: some View {
    let label: String
    let tint: Color

    switch viewModel.connectionState {
    case .connected:
      label = "Connected"
      tint = Color(red: 0.43, green: 0.91, blue: 0.80)
    case .retrying:
      label = "Retrying"
      tint = Color(red: 0.97, green: 0.74, blue: 0.33)
    case .disconnected:
      label = "Disconnected"
      tint = Color(red: 0.90, green: 0.42, blue: 0.42)
    }

    return Text(label.uppercased())
      .font(.system(size: 11, weight: .bold, design: .rounded))
      .tracking(0.7)
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(
        Capsule()
          .fill(tint.opacity(0.22))
          .overlay(Capsule().stroke(tint.opacity(0.85), lineWidth: 1))
      )
      .foregroundStyle(tint)
  }

  private func sectionHeader(_ title: String) -> some View {
    Text(title)
      .font(.system(.title3, design: .rounded).weight(.semibold))
      .foregroundStyle(.white)
  }

  private func emptyState(_ text: String) -> some View {
    Text(text)
      .font(.system(.footnote, design: .rounded))
      .foregroundStyle(Color.white.opacity(0.70))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.white.opacity(0.06))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(Color.white.opacity(0.12), lineWidth: 1)
          )
      )
  }

  private func dangerZone(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(Color(red: 1.0, green: 0.74, blue: 0.52))

      Text(text)
        .font(.system(.caption, design: .rounded))
        .foregroundStyle(Color(red: 1.0, green: 0.79, blue: 0.73))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(Color(red: 0.58, green: 0.17, blue: 0.17).opacity(0.25))
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Color(red: 1.0, green: 0.55, blue: 0.55).opacity(0.44), lineWidth: 1)
        )
    )
  }

  private func resultRow(_ key: String, value: String, emphasize: Bool = false, multiline: Bool = false) -> some View {
    HStack(alignment: multiline ? .top : .center, spacing: 10) {
      Text(key)
        .font(.system(.caption, design: .rounded).weight(.semibold))
        .foregroundStyle(Color.white.opacity(0.70))
        .frame(width: 92, alignment: .leading)

      Text(value)
        .font(.system(.caption, design: .rounded).weight(.semibold))
        .foregroundStyle(emphasize ? Color(red: 0.98, green: 0.72, blue: 0.72) : Color(red: 0.69, green: 0.95, blue: 0.85))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(Color.white.opacity(0.05))
        .overlay(
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(Color.white.opacity(0.10), lineWidth: 1)
        )
    )
  }

  private func actionButton(
    _ title: String,
    icon: String,
    role: ButtonRoleStyle,
    loading: Bool = false,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if loading {
          ProgressView()
            .tint(role.foreground)
            .scaleEffect(0.9)
        } else {
          Image(systemName: icon)
        }
        Text(title)
          .lineLimit(1)
      }
      .font(.system(.footnote, design: .rounded).weight(.semibold))
      .frame(maxWidth: .infinity)
      .padding(.vertical, 10)
      .padding(.horizontal, 8)
    }
    .disabled(loading)
    .foregroundStyle(role.foreground)
    .background(
      RoundedRectangle(cornerRadius: 11, style: .continuous)
        .fill(role.background)
        .overlay(
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(role.border, lineWidth: 1)
        )
    )
  }
}

private struct JarvisCard<Content: View>: View {
  let tint: LinearGradient?
  @ViewBuilder var content: Content

  init(tint: LinearGradient? = nil, @ViewBuilder content: () -> Content) {
    self.tint = tint
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      content
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .fill(Color.white.opacity(0.07))
        .overlay(
          RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(Color.white.opacity(0.15), lineWidth: 1)
        )
        .overlay {
          if let tint {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
              .fill(tint)
          }
        }
    )
    .shadow(color: .black.opacity(0.22), radius: 20, x: 0, y: 10)
  }
}

private enum ButtonRoleStyle {
  case normal
  case primary
  case warning
  case danger

  var background: Color {
    switch self {
    case .normal:
      return Color.white.opacity(0.07)
    case .primary:
      return Color(red: 0.12, green: 0.60, blue: 0.52).opacity(0.95)
    case .warning:
      return Color(red: 0.92, green: 0.60, blue: 0.24).opacity(0.95)
    case .danger:
      return Color(red: 0.80, green: 0.28, blue: 0.30).opacity(0.95)
    }
  }

  var foreground: Color {
    switch self {
    case .normal:
      return .white
    case .primary:
      return Color(red: 0.03, green: 0.22, blue: 0.19)
    case .warning:
      return Color(red: 0.24, green: 0.14, blue: 0.03)
    case .danger:
      return Color(red: 0.20, green: 0.04, blue: 0.05)
    }
  }

  var border: Color {
    switch self {
    case .normal:
      return Color.white.opacity(0.20)
    case .primary:
      return Color(red: 0.26, green: 0.74, blue: 0.64)
    case .warning:
      return Color(red: 0.95, green: 0.75, blue: 0.42)
    case .danger:
      return Color(red: 0.96, green: 0.62, blue: 0.62)
    }
  }
}

private extension View {
  func jarvisFieldStyle() -> some View {
    self
      .font(.system(.footnote, design: .rounded).weight(.medium))
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.black.opacity(0.30))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(Color.white.opacity(0.14), lineWidth: 1)
          )
      )
      .foregroundStyle(Color.white)
  }
}

#Preview {
  ContentView()
}
