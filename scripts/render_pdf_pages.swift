import AppKit
import PDFKit

guard CommandLine.arguments.count >= 4 else {
  fputs("usage: render_pdf_pages <input.pdf> <output-dir> <prefix>\n", stderr)
  exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDir = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let prefix = CommandLine.arguments[3]

try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

guard let document = PDFDocument(url: input) else {
  fputs("failed to open PDF: \(input.path)\n", stderr)
  exit(1)
}

for pageIndex in 0..<document.pageCount {
  guard let page = document.page(at: pageIndex) else { continue }
  let box = page.bounds(for: .mediaBox)
  let scale: CGFloat = 2.0
  let size = NSSize(width: box.width * scale, height: box.height * scale)
  let image = NSImage(size: size)

  image.lockFocus()
  NSColor.white.setFill()
  NSRect(origin: .zero, size: size).fill()
  guard let context = NSGraphicsContext.current?.cgContext else {
    image.unlockFocus()
    continue
  }
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  image.unlockFocus()

  guard
    let tiffData = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiffData),
    let jpegData = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.86])
  else {
    fputs("failed to encode page \(pageIndex + 1)\n", stderr)
    continue
  }

  let output = outputDir.appendingPathComponent(String(format: "\(prefix)-%02d.jpg", pageIndex + 1))
  try jpegData.write(to: output)
  print(output.path)
}
