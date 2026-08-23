//
//  WindowAccessor.swift
//  Jellyfin
//
//  The app has no AppDelegate/SceneDelegate, so there's no direct way to reach
//  the UIWindow SwiftUI is rendering into. This tiny invisible shim grabs it via
//  a backing UIViewController and reports it once available — used by
//  ScreenCaptureService to snapshot the screen for the dashboard's live mirror.
//

import SwiftUI
import UIKit

struct WindowAccessor: UIViewControllerRepresentable {
    let onResolve: (UIWindow) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        ResolverViewController(onResolve: onResolve)
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    private final class ResolverViewController: UIViewController {
        let onResolve: (UIWindow) -> Void

        init(onResolve: @escaping (UIWindow) -> Void) {
            self.onResolve = onResolve
            super.init(nibName: nil, bundle: nil)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("unavailable") }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            if let window = view.window { onResolve(window) }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            if let window = view.window { onResolve(window) }
        }
    }
}
