//
//  RootView.swift
//  Jellyfin
//
//  Routes the whole app based on AppModel.phase. When ready it shows the folder
//  browser; otherwise the connection / waiting / error screens take over. Also
//  overlays the "Identify" flash.
//

import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            model.theme.backgroundGradient
                .ignoresSafeArea()

            content

            if model.isIdentifying {
                IdentifyOverlay(
                    name: model.config.displayName,
                    accent: model.theme.accent,
                    unitId: model.identity.unitId,
                    appVersion: model.identity.appVersion,
                    serverVersion: model.serverVersion,
                    tvosVersion: model.identity.tvosVersion,
                    managementClient: model.management,
                    onDismiss: { model.dismissIdentify() }
                )
                .transition(.opacity)
            }
        }
        // Invisible: just hands the app's UIWindow to screenCapture so the
        // dashboard's live screen mirror has something to snapshot.
        .background(WindowAccessor { model.screenCapture.window = $0 })
        .environment(\.theme, model.theme)
        .preferredColorScheme(model.theme.preferredColorScheme)
        .animation(.smooth, value: model.phase)
        .animation(.smooth, value: model.isIdentifying)
        .task { await model.start() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .ready:
            BrowseRootView()
        case .launching, .registering:
            ConnectingView(title: model.config.appearance.appTitle,
                           message: "Connecting to the management server…")
        case .connectingJellyfin:
            ConnectingView(title: model.config.appearance.appTitle,
                           message: "Loading…")
        case .waitingForContent:
            WaitingForContentView()
        case .needsManagementServer:
            // A unit that has never registered doesn't know its server yet, so it
            // needs the address-entry screen. A unit that already has a device
            // token has connected before — losing the connection later (network
            // blip, server restart/migration) isn't a setup problem, and prompting
            // for the server address again would be confusing since the app
            // already knows it and is retrying automatically in the background.
            if model.identity.deviceToken == nil {
                ManagementSetupView()
            } else {
                ErrorView(
                    title: "Lost connection to the management server",
                    message: "This Apple TV can't reach \(model.identity.managementBaseURL) right now. It will keep retrying automatically.",
                    retryTitle: "Retry Now",
                    retry: { model.retry() }
                )
            }
        case .error(let message):
            ErrorView(title: "Something went wrong", message: message, retry: { model.retry() })
        }
    }
}

/// The folder browser: the unit's libraries (or a pinned home library) → folders →
/// videos. Tapping a video opens the player directly.
struct BrowseRootView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let root = model.rootLibrary {
                    LibraryFolderView(parent: root)
                } else {
                    LibrariesView()
                }
            }
            .mediaDestinations()
        }
        // Only at the browse root (not on pushed folders): a quiet build marker
        // for spotting which version a unit is actually running without digging
        // into the admin dashboard.
        .overlay(alignment: .bottom) {
            if path.isEmpty {
                Text(model.identity.appVersion)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.3))
                    .padding(.bottom, 24)
            }
        }
    }
}
