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

            if model.identifyFlash {
                IdentifyOverlay(name: model.config.displayName, accent: model.theme.accent)
                    .transition(.opacity)
            }
        }
        .environment(\.theme, model.theme)
        .preferredColorScheme(model.theme.preferredColorScheme)
        .animation(.smooth, value: model.phase)
        .animation(.smooth, value: model.identifyFlash)
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
            ManagementSetupView()
        case .error(let message):
            ErrorView(title: "Something went wrong", message: message, retry: { model.retry() })
        }
    }
}

/// The folder browser: the unit's libraries (or a pinned home library) → folders →
/// videos. Tapping a video opens the player directly.
struct BrowseRootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                if let root = model.rootLibrary {
                    LibraryFolderView(parent: root)
                } else {
                    LibrariesView()
                }
            }
            .mediaDestinations()
        }
    }
}
