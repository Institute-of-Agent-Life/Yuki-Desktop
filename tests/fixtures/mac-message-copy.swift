import AppKit
import ApplicationServices
import Carbon.HIToolbox

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments
if arguments[1] == "preserve-clipboard" {
    let pasteboard = NSPasteboard.general
    let saved = (pasteboard.pasteboardItems ?? []).map { item in
        let copy = NSPasteboardItem()
        for type in item.types {
            if let data = item.data(forType: type) { copy.setData(data, forType: type) }
        }
        return copy
    }
    print("ready")
    fflush(stdout)
    _ = readLine()
    if let text = pasteboard.string(forType: .string), arguments.dropFirst(2).contains(text) {
        pasteboard.clearContents()
        if !saved.isEmpty { pasteboard.writeObjects(saved) }
    }
    exit(0)
}

guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
    fail("The interactive test runner needs macOS Accessibility access")
}
let pid = pid_t(arguments[2])!
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
    fail("The test Electron process is not the foreground app")
}
if arguments[1] == "shortcut" {
    for down in [true, false] {
        let key = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(kVK_ANSI_C), keyDown: down)!
        key.flags = .maskCommand
        key.post(tap: .cghidEventTap)
    }
    print("Command+C")
    exit(0)
}

let app = AXUIElementCreateApplication(pid)
let point = CGPoint(x: Double(arguments[3])!, y: Double(arguments[4])!)
var target: AXUIElement?
guard AXUIElementCopyElementAtPosition(app, Float(point.x), Float(point.y), &target) == .success,
      let target else {
    fail("The message coordinates are outside the test app")
}
var targetPid: pid_t = 0
AXUIElementGetPid(target, &targetPid)
guard targetPid == pid else { fail("The message coordinates hit another process") }

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return value
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}

for type: CGEventType in [.mouseMoved, .rightMouseDown, .rightMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .right)!
        .post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
}

for _ in 0..<30 {
    let windows = children(app).filter { attribute($0, kAXRoleAttribute) as? String == kAXWindowRole }
    let menu = (children(app) + windows.flatMap(children)).first {
        attribute($0, kAXRoleAttribute) as? String == kAXMenuRole
    }
    if let menu, let copy = children(menu).first(where: {
        attribute($0, kAXTitleAttribute) as? String == "複製"
    }) {
        guard AXUIElementPerformAction(copy, kAXPressAction as CFString) == .success else {
            fail("Could not activate the native Copy menu item")
        }
        print("AXMenu → 複製")
        exit(0)
    }
    Thread.sleep(forTimeInterval: 0.1)
}
fail("The native message menu did not expose its Copy item")
