fn main() {
    // Link CoreGraphics on macOS for screen capture permission APIs
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=CoreGraphics");

    tauri_build::build()
}
