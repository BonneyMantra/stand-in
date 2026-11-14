// Stand-in fingerprint gate. Exit 0 = approved, 1 = failed or cancelled, 2 = biometrics unavailable.
//   standin-touchid --check          availability only, never shows a prompt
//   standin-touchid "<reason text>"  shows the Touch ID prompt with that reason
import Foundation
import LocalAuthentication

let args = Array(CommandLine.arguments.dropFirst())
let ctx = LAContext()
var err: NSError?
guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
    FileHandle.standardError.write("touchid unavailable: \(err?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(2)
}
if args.first == "--check" { print("touchid available"); exit(0) }
let reason = args.isEmpty ? "Approve this Stand-in action" : args.joined(separator: " ")
let sem = DispatchSemaphore(value: 0)
var ok = false
ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
    ok = success
    sem.signal()
}
sem.wait()
exit(ok ? 0 : 1)
