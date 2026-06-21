//
//  JellyfinApp.swift
//  Jellyfin
//
//  Jellyfin — a centrally managed Jellyfin player for Apple TV.
//

import SwiftUI

@main
struct JellyfinApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}
