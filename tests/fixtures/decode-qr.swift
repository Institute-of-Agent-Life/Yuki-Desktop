import Foundation
import Vision

// Decode the pixels produced by the real renderer; never print this payload in
// test logs. The caller compares it in memory and removes the temporary image.
let image = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(url: image).perform([request])
guard let payload = request.results?.first?.payloadStringValue else { exit(1) }
FileHandle.standardOutput.write(Data(payload.utf8))
