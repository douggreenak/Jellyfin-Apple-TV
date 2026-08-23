//
//  ScreenCaptureService.swift
//  Jellyfin
//
//  Captures the app's own on-screen content and hands back a compressed JPEG,
//  for the management dashboard's live screen mirror. AppModel only drives this
//  while a dashboard operator has the panel open (see its live-status poll loop)
//  — it never captures or uploads in the background.
//
//  Known limitation: DRM-protected video frames can render black in captures
//  (an OS-level restriction apps can't opt out of). Doesn't matter in practice —
//  Jellyfin content is normally not DRM'd, and menus/browsing UI capture fine
//  regardless.
//

import UIKit

@MainActor
final class ScreenCaptureService {
    /// Set by `WindowAccessor` once the app's key window is available.
    weak var window: UIWindow?

    /// Renders the current window contents, scaled down and JPEG-compressed to
    /// keep uploads small and fast — this is a fast-refreshing snapshot for
    /// troubleshooting, not an archival-quality capture.
    func captureJPEG(maxWidth: CGFloat = 960, quality: CGFloat = 0.55) -> Data? {
        guard let window, window.bounds.width > 0, window.bounds.height > 0 else { return nil }

        let scale = min(1, maxWidth / window.bounds.width)
        let targetSize = CGSize(
            width: (window.bounds.width * scale).rounded(),
            height: (window.bounds.height * scale).rounded()
        )
        guard targetSize.width > 0, targetSize.height > 0 else { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1 // downscaling already happens via targetSize; keep output small
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)

        let image = renderer.image { _ in
            window.drawHierarchy(in: CGRect(origin: .zero, size: targetSize), afterScreenUpdates: false)
        }
        return image.jpegData(compressionQuality: quality)
    }
}
