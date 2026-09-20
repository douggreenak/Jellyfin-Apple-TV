//
//  ConnectingView.swift
//  Jellyfin
//
//  Splash / connection states: the launch spinner, the first-run management
//  server prompt, the "waiting for an administrator" screen, and the Identify
//  overlay.
//

import SwiftUI

// MARK: - Connecting splash

struct ConnectingView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 36) {
            BrandMark(title: title)
            ProgressView()
                .controlSize(.large)
            Text(message)
                .font(.title3)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The app wordmark used across splash screens.
struct BrandMark: View {
    @Environment(\.theme) private var theme
    let title: String

    var body: some View {
        HStack(spacing: 20) {
            Image(systemName: "play.tv.fill")
                .font(.system(size: 64))
                .foregroundStyle(theme.accent)
            Text(title)
                .font(.system(size: 64, weight: .bold, design: .rounded))
        }
    }
}

// MARK: - First-run: where is the management server?

struct ManagementSetupView: View {
    @Environment(AppModel.self) private var model
    @State private var address: String = ""
    @State private var connecting = false

    var body: some View {
        VStack(spacing: 26) {
            BrandMark(title: model.config.appearance.appTitle)

            VStack(spacing: 8) {
                Text("Management server required")
                    .font(.title2.bold())
                Text("This Apple TV is managed entirely by your Jellyfin management server. Enter its address to continue — the app won't operate until it can reach the server.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 1000)
            }

            TextField("http://172.16.50.100:4000", text: $address)
                .textContentType(.URL)
                .frame(maxWidth: 900)
                .disabled(connecting)

            if model.connectionFailed && !connecting {
                Label("Failed to connect to server", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline)
                    .foregroundStyle(.red)
                    .transition(.opacity)
            }

            Button(action: connect) {
                if connecting {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Connecting…")
                    }
                    .padding(.horizontal, 14)
                } else {
                    Text("Connect")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(connecting || address.trimmingCharacters(in: .whitespaces).isEmpty)

            Text("This unit's ID: \(model.identity.unitId)")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(80)
        .animation(.easeInOut(duration: 0.2), value: model.connectionFailed)
        .animation(.easeInOut(duration: 0.2), value: connecting)
        .onAppear { if address.isEmpty { address = model.identity.managementBaseURL } }
    }

    private func connect() {
        let url = address.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty else { return }
        connecting = true
        Task {
            await model.connect(to: url)
            connecting = false
        }
    }
}

// MARK: - Registered, but no library assigned yet

struct WaitingForContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 96))
                .foregroundStyle(.green)
            Text("Connected and ready")
                .font(.largeTitle.bold())
            Text("This Apple TV is registered with the management server and is waiting for content to be assigned.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 1000)

            VStack(spacing: 6) {
                Text(model.config.displayName)
                    .font(.title3.weight(.semibold))
                Text("Unit ID \(model.identity.unitId)")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
            }
            .padding(.top, 12)

            ProgressView()
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(80)
    }
}

// MARK: - Identify overlay

/// Full-screen "here I am" marker, shown for as long as the server's persistent
/// `identifying` state is true (see `AppModel.isIdentifying`) — not a timed
/// flash. Dismissible from either end: an admin can turn it off from the
/// dashboard at any time, or the person standing in front of the TV can press
/// Select or Menu on the physical remote right here.
struct IdentifyOverlay: View {
    let name: String
    let accent: Color
    let unitId: String
    let appVersion: String
    let serverVersion: String?
    let tvosVersion: String
    let managementClient: ManagementClient
    let onDismiss: () -> Void

    @State private var ipAddress: String?
    @State private var throughputMbps: Double?
    @State private var measuringThroughput = true

    var body: some View {
        Button(action: onDismiss) {
            ZStack {
                accent.ignoresSafeArea()
                VStack(spacing: 28) {
                    Image(systemName: "hand.wave.fill")
                        .font(.system(size: 100))
                    Text(name)
                        .font(.system(size: 72, weight: .heavy, design: .rounded))
                    Text("This is the Apple TV you're looking for")
                        .font(.title3)
                        .opacity(0.85)

                    VStack(alignment: .leading, spacing: 12) {
                        IdentifyInfoRow(label: "IP address", value: ipAddress ?? "Unavailable")
                        IdentifyInfoRow(label: "Connection speed", value: throughputText)
                        IdentifyInfoRow(label: "App version", value: appVersion)
                        IdentifyInfoRow(label: "Server version", value: serverVersion ?? "Unknown")
                        IdentifyInfoRow(label: "tvOS version", value: tvosVersion)
                        IdentifyInfoRow(label: "Unit ID", value: unitId)
                    }
                    .padding(28)
                    .background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                    Text("Press Select or Menu to dismiss")
                        .font(.callout)
                        .opacity(0.7)
                }
                .foregroundStyle(.white)
                .padding(60)
            }
        }
        .buttonStyle(.plain)
        .onExitCommand(perform: onDismiss)
        .task {
            ipAddress = NetworkInfo.localIPAddress
            throughputMbps = await managementClient.measureThroughputMbps()
            measuringThroughput = false
        }
    }

    private var throughputText: String {
        if measuringThroughput { return "Measuring…" }
        guard let throughputMbps else { return "Unavailable" }
        return String(format: "%.1f Mbps", throughputMbps)
    }
}

private struct IdentifyInfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .opacity(0.7)
            Spacer(minLength: 60)
            Text(value)
                .fontWeight(.semibold)
        }
        .font(.title3)
        .frame(minWidth: 560, alignment: .leading)
    }
}
