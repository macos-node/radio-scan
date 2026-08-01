// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RadioBar",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "RadioBar", path: "Sources/RadioBar")
    ]
)
