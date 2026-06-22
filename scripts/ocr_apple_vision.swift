import AppKit
import Foundation
import Vision

if CommandLine.arguments.count < 2 {
    fputs("usage: ocr_apple_vision <image>\n", stderr)
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let nsImage = NSImage(contentsOf: imageURL) else {
    fputs("failed to load image\n", stderr)
    exit(1)
}

var proposedRect = CGRect(origin: .zero, size: nsImage.size)
guard let cgImage = nsImage.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    fputs("failed to convert image\n", stderr)
    exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["ja-JP", "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fputs("vision request failed: \(error)\n", stderr)
    exit(1)
}

let lines = (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
