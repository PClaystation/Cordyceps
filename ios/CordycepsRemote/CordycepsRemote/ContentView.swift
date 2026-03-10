import SwiftUI

struct ContentView: View {
  @StateObject private var viewModel = RemoteViewModel()
  @Environment(\.scenePhase) private var scenePhase

  @State private var showDangerousSendConfirmation = false
  @State private var showUpdateConfirmation = false

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
        .refreshable {
          await viewModel.loadDevices()
        }
      }
      .navigationTitle("Cordyceps Bloom")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          if viewModel.isLoadingDevices {
            ProgressView()
              .tint(CordycepsTheme.myceliumGlow)
          } else {
            Button {
              Task { await viewModel.loadDevices() }
            } label: {
              Label("Refresh", systemImage: "arrow.clockwise")
            }
            .tint(CordycepsTheme.myceliumGlow)
          }
        }
      }
      .task {
        await viewModel.handleInitialLoad()
      }
      .onOpenURL { url in
        viewModel.applyPairingLink(url.absoluteString)
      }
      .onChange(of: scenePhase) { phase in
        viewModel.setAppLifecycle(isActive: phase == .active)
      }
      .confirmationDialog(
        "This command can immediately interrupt the target device.",
        isPresented: $showDangerousSendConfirmation,
        titleVisibility: .visible
      ) {
        Button("Send Anyway", role: .destructive) {
          Task { await viewModel.sendCommand() }
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Confirm that the target is correct before dispatching.")
      }
      .confirmationDialog(
        "Push this agent update now?",
        isPresented: $showUpdateConfirmation,
        titleVisibility: .visible
      ) {
        Button("Push Update", role: .destructive) {
          Task { await viewModel.pushUpdate() }
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("Updates may restart agents and break connectivity if details are wrong.")
      }
    }
  }

  private var backgroundLayer: some View {
    ZStack {
      LinearGradient(
        colors: [CordycepsTheme.soilBlack, CordycepsTheme.soilDeep, CordycepsTheme.forestNight],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .ignoresSafeArea()

      Circle()
        .fill(
          RadialGradient(
            colors: [CordycepsTheme.myceliumGlow.opacity(0.45), .clear],
            center: .center,
            startRadius: 8,
            endRadius: 260
          )
        )
        .frame(width: 360, height: 360)
        .offset(x: -130, y: -280)
        .blur(radius: 8)

      Circle()
        .fill(
          RadialGradient(
            colors: [CordycepsTheme.capsuleAmber.opacity(0.34), .clear],
            center: .center,
            startRadius: 8,
            endRadius: 240
          )
        )
        .frame(width: 300, height: 300)
        .offset(x: 170, y: -320)
        .blur(radius: 8)

      Capsule()
        .fill(CordycepsTheme.sporePurple.opacity(0.18))
        .frame(width: 420, height: 190)
        .rotationEffect(.degrees(-18))
        .offset(x: 60, y: 290)
        .blur(radius: 40)
    }
  }

  private var heroCard: some View {
    CordycepsCard(
      tint: LinearGradient(
        colors: [
          CordycepsTheme.myceliumGlow.opacity(0.35),
          CordycepsTheme.capsuleAmber.opacity(0.26),
          CordycepsTheme.sporePurple.opacity(0.18),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    ) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .top, spacing: 12) {
          VStack(alignment: .leading, spacing: 6) {
            Text("Mycelium command nexus")
              .font(.system(.title3, design: .rounded).weight(.bold))
              .foregroundStyle(.white)
            Text("Fungus-themed remote control for your Cordyceps fleet with live state, safer dispatch, and fast reuse.")
              .font(.system(.footnote, design: .rounded))
              .foregroundStyle(Color.white.opacity(0.78))
          }

          Spacer(minLength: 0)
          statusBadge
        }

        HStack {
          Text(viewModel.lastSuccessLabel)
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .foregroundStyle(Color.white.opacity(0.76))
          Spacer(minLength: 0)
          Text(viewModel.deviceSummaryText)
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .foregroundStyle(CordycepsTheme.myceliumGlow.opacity(0.9))
        }
      }
    }
  }

  private var connectionCard: some View {
    CordycepsCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Connection")

        TextField("https://your-cordyceps-host.example", text: $viewModel.apiBaseInput)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()

        SecureField("PHONE_API_TOKEN", text: $viewModel.tokenInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()

        TextField("Default target (m1)", text: $viewModel.targetInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.targetInput) { _ in
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

          TextField("Paste pairing URL", text: $viewModel.pairingLinkInput)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
            .autocorrectionDisabled()
            .cordycepsFieldStyle()

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
          .foregroundStyle(
            viewModel.statusIsError
              ? CordycepsTheme.errorText
              : Color.white.opacity(0.74)
          )
      }
    }
  }

  private var devicesCard: some View {
    CordycepsCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Devices")

        HStack(spacing: 8) {
          TextField("Search name, host, or ID", text: $viewModel.deviceSearchInput)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .cordycepsFieldStyle()

          Button {
            viewModel.showOnlyOnlineDevices.toggle()
          } label: {
            HStack(spacing: 6) {
              Image(systemName: viewModel.showOnlyOnlineDevices ? "dot.radiowaves.left.and.right" : "circle.dashed")
              Text("Online")
                .lineLimit(1)
            }
            .font(.system(.footnote, design: .rounded).weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
              Capsule()
                .fill(viewModel.showOnlyOnlineDevices ? CordycepsTheme.primaryButton.opacity(0.85) : CordycepsTheme.cardFill)
                .overlay(Capsule().stroke(CordycepsTheme.strokeSoft, lineWidth: 1))
            )
          }
          .foregroundStyle(viewModel.showOnlyOnlineDevices ? CordycepsTheme.buttonTextPrimary : Color.white)
        }

        if viewModel.devices.isEmpty {
          emptyState("No enrolled devices loaded yet.")
        } else if viewModel.filteredDevices.isEmpty {
          emptyState("No devices match your current filters.")
        } else {
          ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: 10) {
              ForEach(viewModel.filteredDevices) { device in
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
      Text(device.displayTitle)
        .font(.system(.headline, design: .rounded).weight(.bold))
        .foregroundStyle(.white)
        .lineLimit(1)

      if let subtitle = device.subtitleLabel {
        Text(subtitle)
          .font(.system(.caption2, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.68))
          .lineLimit(2)
      }

      HStack(spacing: 8) {
        Capsule()
          .fill(device.isOnline ? CordycepsTheme.myceliumGlow : CordycepsTheme.errorDot)
          .frame(width: 8, height: 8)
        Text(device.isOnline ? "online" : "offline")
          .font(.system(.caption, design: .rounded).weight(.semibold))
          .foregroundStyle(device.isOnline ? CordycepsTheme.myceliumGlow : CordycepsTheme.errorText)
      }

      Text("last seen \(device.lastSeenLabel)")
        .font(.system(.caption2, design: .rounded))
        .foregroundStyle(Color.white.opacity(0.66))

      if let version = device.version, !version.isEmpty {
        Text("agent \(version)")
          .font(.system(.caption2, design: .rounded).weight(.semibold))
          .foregroundStyle(CordycepsTheme.capsuleAmber.opacity(0.95))
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
      .tint(device.isOnline ? CordycepsTheme.primaryButton : CordycepsTheme.offlineButton)
    }
    .padding(12)
    .frame(width: 220, height: 182, alignment: .topLeading)
    .background(
      RoundedRectangle(cornerRadius: 15, style: .continuous)
        .fill(CordycepsTheme.cardFill)
        .overlay(
          RoundedRectangle(cornerRadius: 15, style: .continuous)
            .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
        )
    )
  }

  private var commandCard: some View {
    CordycepsCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Command")

        TextField("Target (m1 or all)", text: $viewModel.targetInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.targetInput) { _ in
            viewModel.targetDidChange()
          }

        TextField("Search commands, aliases, and apps", text: $viewModel.actionSearchInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.actionSearchInput) { _ in
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
        .tint(CordycepsTheme.myceliumGlow)
        .onChange(of: viewModel.selectedActionValue) { _ in
          viewModel.actionSelectionDidChange()
        }

        Text(viewModel.actionSearchInfo)
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.70))

        if viewModel.selectedActionUsesArgument {
          TextField(viewModel.selectedActionArgumentPlaceholder, text: $viewModel.argumentInput)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .cordycepsFieldStyle()
            .onChange(of: viewModel.argumentInput) { _ in
              viewModel.composeFromInputs()
            }
        }

        if viewModel.selectedActionIsDangerous {
          dangerZone("This command can interrupt the machine immediately. Review target and intent before sending.")
        }

        Text("Quick Cast")
          .font(.system(.caption, design: .rounded).weight(.semibold))
          .foregroundStyle(Color.white.opacity(0.74))

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
                  .fill(CordycepsTheme.cardFill)
                  .overlay(Capsule().stroke(CordycepsTheme.strokeSoft, lineWidth: 1))
              )
              .foregroundStyle(Color.white.opacity(0.88))
            }
          }
          .padding(.vertical, 2)
        }

        if !viewModel.recentCommands.isEmpty {
          HStack {
            Text("Recent")
              .font(.system(.caption, design: .rounded).weight(.semibold))
              .foregroundStyle(Color.white.opacity(0.74))
            Spacer(minLength: 0)
            Button("Clear") {
              viewModel.clearRecentCommands()
            }
            .font(.system(.caption, design: .rounded).weight(.semibold))
            .foregroundStyle(CordycepsTheme.capsuleAmber.opacity(0.95))
          }

          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
              ForEach(viewModel.recentCommands, id: \.self) { command in
                Button {
                  viewModel.useRecentCommand(command)
                } label: {
                  Text(command)
                    .font(.system(.caption, design: .monospaced).weight(.medium))
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                }
                .foregroundStyle(CordycepsTheme.myceliumGlow)
                .background(
                  RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.black.opacity(0.23))
                    .overlay(
                      RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
                    )
                )
              }
            }
            .padding(.vertical, 2)
          }
        }

        TextField("Command text", text: $viewModel.commandText, axis: .vertical)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .lineLimit(2 ... 6)
          .cordycepsFieldStyle()

        HStack(spacing: 8) {
          actionButton("Build", icon: "wand.and.stars", role: .normal) {
            viewModel.composeFromInputs()
          }
          actionButton("Copy", icon: "doc.on.doc", role: .normal) {
            viewModel.copyCommandToClipboard()
          }
          actionButton(
            viewModel.isListening ? "Stop" : "Speak",
            icon: viewModel.isListening ? "waveform.slash" : "waveform",
            role: .normal
          ) {
            Task { await viewModel.toggleSpeechCapture() }
          }
        }

        actionButton(
          "Send Command",
          icon: "paperplane.fill",
          role: viewModel.selectedActionIsDangerous ? .danger : .primary,
          loading: viewModel.isSendingCommand
        ) {
          if viewModel.selectedActionIsDangerous {
            showDangerousSendConfirmation = true
          } else {
            Task { await viewModel.sendCommand() }
          }
        }

        Text(viewModel.speechInfoText)
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(viewModel.speechSupported ? Color.white.opacity(0.70) : CordycepsTheme.errorText)
      }
    }
  }

  private var updateCard: some View {
    CordycepsCard {
      VStack(alignment: .leading, spacing: 12) {
        sectionHeader("Agent Update")

        Text("Push a verified agent package to one target or all online devices.")
          .font(.system(.caption, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.72))

        dangerZone("Updates can restart agents and cut off remote control if package metadata is wrong.")

        TextField("Target (m1 or all)", text: $viewModel.updateTargetInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.updateTargetInput) { _ in
            viewModel.persistUpdateSettings()
          }

        TextField("Version (0.2.0)", text: $viewModel.updateVersionInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.updateVersionInput) { _ in
            viewModel.persistUpdateSettings()
          }

        TextField("Package URL (https://...)", text: $viewModel.updateURLInput)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.updateURLInput) { _ in
            viewModel.persistUpdateSettings()
          }

        TextField("SHA256 (optional 64 hex chars)", text: $viewModel.updateShaInput)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .cordycepsFieldStyle()
          .onChange(of: viewModel.updateShaInput) { _ in
            viewModel.persistUpdateSettings()
          }

        TextField("Size bytes (optional)", text: $viewModel.updateSizeInput)
          .keyboardType(.numberPad)
          .cordycepsFieldStyle()
          .onChange(of: viewModel.updateSizeInput) { _ in
            viewModel.persistUpdateSettings()
          }

        actionButton("Review & Push", icon: "arrow.up.circle.fill", role: .warning, loading: viewModel.isPushingUpdate) {
          showUpdateConfirmation = true
        }
      }
    }
  }

  private var resultCard: some View {
    CordycepsCard {
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
            .foregroundStyle(CordycepsTheme.resultText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
        }
        .frame(minHeight: 130, maxHeight: 260)
        .padding(12)
        .background(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Color.black.opacity(0.32))
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
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
      tint = CordycepsTheme.myceliumGlow
    case .retrying:
      label = "Retrying"
      tint = CordycepsTheme.capsuleAmber
    case .disconnected:
      label = "Disconnected"
      tint = CordycepsTheme.errorDot
    }

    return Text(label.uppercased())
      .font(.system(size: 11, weight: .bold, design: .rounded))
      .tracking(0.7)
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(
        Capsule()
          .fill(tint.opacity(0.24))
          .overlay(Capsule().stroke(tint.opacity(0.86), lineWidth: 1))
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
          .fill(CordycepsTheme.cardFill)
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
          )
      )
  }

  private func dangerZone(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(CordycepsTheme.capsuleAmber)

      Text(text)
        .font(.system(.caption, design: .rounded))
        .foregroundStyle(CordycepsTheme.errorText)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(CordycepsTheme.dangerFill)
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(CordycepsTheme.dangerStroke, lineWidth: 1)
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
        .foregroundStyle(emphasize ? CordycepsTheme.errorText : CordycepsTheme.myceliumGlow)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(10)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(CordycepsTheme.cardFill)
        .overlay(
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
        )
    )
  }

  private func actionButton(
    _ title: String,
    icon: String,
    role: ButtonRoleStyle,
    loading: Bool = false,
    disabled: Bool = false,
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
    .disabled(loading || disabled)
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

private enum CordycepsTheme {
  static let soilBlack = Color(red: 0.04, green: 0.04, blue: 0.03)
  static let soilDeep = Color(red: 0.09, green: 0.08, blue: 0.05)
  static let forestNight = Color(red: 0.09, green: 0.14, blue: 0.09)

  static let myceliumGlow = Color(red: 0.62, green: 0.90, blue: 0.66)
  static let capsuleAmber = Color(red: 0.95, green: 0.68, blue: 0.32)
  static let sporePurple = Color(red: 0.52, green: 0.42, blue: 0.60)

  static let primaryButton = Color(red: 0.26, green: 0.64, blue: 0.35)
  static let buttonTextPrimary = Color(red: 0.05, green: 0.20, blue: 0.09)
  static let offlineButton = Color(red: 0.28, green: 0.31, blue: 0.27)

  static let cardFill = Color.white.opacity(0.07)
  static let strokeSoft = Color.white.opacity(0.16)

  static let dangerFill = Color(red: 0.40, green: 0.14, blue: 0.10).opacity(0.30)
  static let dangerStroke = Color(red: 0.92, green: 0.52, blue: 0.46).opacity(0.56)
  static let errorText = Color(red: 1.0, green: 0.78, blue: 0.74)
  static let errorDot = Color(red: 0.92, green: 0.47, blue: 0.46)

  static let resultText = Color(red: 0.90, green: 0.95, blue: 0.91)
}

private struct CordycepsCard<Content: View>: View {
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
        .fill(CordycepsTheme.cardFill)
        .overlay(
          RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
        )
        .overlay {
          if let tint {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
              .fill(tint)
          }
        }
    )
    .shadow(color: .black.opacity(0.24), radius: 22, x: 0, y: 10)
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
      return CordycepsTheme.cardFill
    case .primary:
      return CordycepsTheme.primaryButton.opacity(0.95)
    case .warning:
      return CordycepsTheme.capsuleAmber.opacity(0.95)
    case .danger:
      return Color(red: 0.76, green: 0.28, blue: 0.25).opacity(0.95)
    }
  }

  var foreground: Color {
    switch self {
    case .normal:
      return .white
    case .primary:
      return CordycepsTheme.buttonTextPrimary
    case .warning:
      return Color(red: 0.29, green: 0.17, blue: 0.06)
    case .danger:
      return Color(red: 0.25, green: 0.06, blue: 0.05)
    }
  }

  var border: Color {
    switch self {
    case .normal:
      return CordycepsTheme.strokeSoft
    case .primary:
      return CordycepsTheme.myceliumGlow.opacity(0.9)
    case .warning:
      return CordycepsTheme.capsuleAmber
    case .danger:
      return Color(red: 0.95, green: 0.67, blue: 0.62)
    }
  }
}

private extension View {
  func cordycepsFieldStyle() -> some View {
    self
      .font(.system(.footnote, design: .rounded).weight(.medium))
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .background(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.black.opacity(0.30))
          .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
              .stroke(CordycepsTheme.strokeSoft, lineWidth: 1)
          )
      )
      .foregroundStyle(Color.white)
  }
}

#Preview {
  ContentView()
}
