use crate::{CaptureResult, CaptureSource};
use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;
#[cfg(target_os = "macos")]
use std::ffi::c_void;
use std::io::Cursor;
use xcap::Monitor;
#[cfg(not(target_os = "macos"))]
use xcap::Window;

#[cfg(target_os = "macos")]
use objc2_core_foundation::{CFDictionary, CFNumber, CFNumberType, CFRetained, CFString, CGRect};
#[cfg(target_os = "macos")]
use objc2_core_graphics::{
    CGDataProvider, CGImage, CGRectMakeWithDictionaryRepresentation, CGWindowImageOption,
    CGWindowListCopyWindowInfo, CGWindowListCreateImage, CGWindowListOption,
};

/// Capture a specific source (monitor or window), scale to fit, encode as JPEG.
pub fn take_screenshot(
    source: CaptureSource,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
) -> Result<CaptureResult, String> {
    let img = match source {
        CaptureSource::Monitor { id } => {
            let monitor = Monitor::all()
                .map_err(|e| format!("Failed to enumerate monitors: {e}"))?
                .into_iter()
                .find(|m| m.id().ok() == Some(id))
                .ok_or_else(|| format!("Monitor with id {id} not found"))?;
            monitor
                .capture_image()
                .map_err(|e| format!("Screen capture failed: {e}"))?
        }
        CaptureSource::Window { id } => {
            #[cfg(target_os = "macos")]
            {
                return take_window_screenshot_macos(id, max_width, max_height, jpeg_quality);
            }

            #[cfg(not(target_os = "macos"))]
            {
                let window = Window::all()
                    .map_err(|e| format!("Failed to enumerate windows: {e}"))?
                    .into_iter()
                    .find(|w| w.id().ok() == Some(id))
                    .ok_or_else(|| format!("Window with id {id} not found"))?;
                window
                    .capture_image()
                    .map_err(|e| format!("Window capture failed: {e}"))?
            }
        }
    };

    let mut dynamic = DynamicImage::ImageRgba8(img);

    // Scale down if needed (preserving aspect ratio)
    let (w, h) = (dynamic.width(), dynamic.height());
    if w > max_width || h > max_height {
        let scale = f64::min(max_width as f64 / w as f64, max_height as f64 / h as f64);
        let new_w = (w as f64 * scale).round() as u32;
        let new_h = (h as f64 * scale).round() as u32;
        dynamic = dynamic.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);
    }

    let (final_w, final_h) = (dynamic.width(), dynamic.height());

    // Encode as JPEG
    let rgb = dynamic.to_rgb8();
    let mut jpeg_buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_buf, jpeg_quality);
    encoder
        .encode_image(&rgb)
        .map_err(|e| format!("JPEG encoding failed: {e}"))?;

    let jpeg_bytes = jpeg_buf.into_inner();
    let size_bytes = jpeg_bytes.len();

    use base64::Engine;
    let base64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);

    Ok(CaptureResult {
        base64,
        width: final_w,
        height: final_h,
        size_bytes,
    })
}

#[cfg(target_os = "macos")]
pub fn take_window_screenshot_macos(
    id: u32,
    max_width: u32,
    max_height: u32,
    jpeg_quality: u8,
) -> Result<CaptureResult, String> {
    let window = get_window_cf_dictionary_any_space(id)?;
    let bounds = get_window_cg_rect(window.as_ref())?;

    let cg_image = CGWindowListCreateImage(
        bounds,
        CGWindowListOption::OptionIncludingWindow,
        id,
        CGWindowImageOption::Default,
    );

    let rgba =
        cgimage_to_rgba8(cg_image).ok_or_else(|| "Window capture decode failed".to_string())?;
    let mut dynamic = DynamicImage::ImageRgba8(rgba);

    let (w, h) = (dynamic.width(), dynamic.height());
    if w > max_width || h > max_height {
        let scale = f64::min(max_width as f64 / w as f64, max_height as f64 / h as f64);
        let new_w = (w as f64 * scale).round() as u32;
        let new_h = (h as f64 * scale).round() as u32;
        dynamic = dynamic.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);
    }

    let (final_w, final_h) = (dynamic.width(), dynamic.height());
    let rgb = dynamic.to_rgb8();
    let mut jpeg_buf = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_buf, jpeg_quality);
    encoder
        .encode_image(&rgb)
        .map_err(|e| format!("JPEG encoding failed: {e}"))?;

    let jpeg_bytes = jpeg_buf.into_inner();
    let size_bytes = jpeg_bytes.len();
    use base64::Engine;
    let base64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_bytes);

    Ok(CaptureResult {
        base64,
        width: final_w,
        height: final_h,
        size_bytes,
    })
}

#[cfg(target_os = "macos")]
fn get_cf_dictionary_get_value(
    cf_dictionary: &CFDictionary,
    key: &str,
) -> Result<*const c_void, String> {
    let key = CFString::from_str(key);
    let key_ref = key.as_ref() as *const CFString;
    let value = unsafe { cf_dictionary.value(key_ref.cast()) };
    if value.is_null() {
        return Err(format!("Missing {key} in window metadata"));
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
fn get_cf_number_i32_value(cf_dictionary: &CFDictionary, key: &str) -> Result<i32, String> {
    let cf_number = get_cf_dictionary_get_value(cf_dictionary, key)? as *const CFNumber;
    let mut value: i32 = 0;
    let ok =
        unsafe { (*cf_number).value(CFNumberType::IntType, &mut value as *mut _ as *mut c_void) };
    if !ok {
        return Err(format!("Invalid CFNumber for {key}"));
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
fn get_window_cf_dictionary_any_space(window_id: u32) -> Result<CFRetained<CFDictionary>, String> {
    let windows = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionAll | CGWindowListOption::ExcludeDesktopElements,
        0,
    )
    .ok_or_else(|| "Failed to enumerate macOS windows".to_string())?;

    for i in 0..windows.count() {
        let window_dict_ref = unsafe { windows.value_at_index(i) } as *const CFDictionary;
        if window_dict_ref.is_null() {
            continue;
        }
        let window_dict = unsafe { &*window_dict_ref };
        let current_id = match get_cf_number_i32_value(window_dict, "kCGWindowNumber") {
            Ok(v) => v as u32,
            Err(_) => continue,
        };
        if current_id == window_id {
            let copy = CFDictionary::new_copy(None, Some(window_dict))
                .ok_or_else(|| "Failed to copy window metadata".to_string())?;
            return Ok(copy);
        }
    }

    Err(format!("Window with id {window_id} not found"))
}

#[cfg(target_os = "macos")]
fn get_window_cg_rect(window_cf_dictionary: &CFDictionary) -> Result<CGRect, String> {
    let bounds = get_cf_dictionary_get_value(window_cf_dictionary, "kCGWindowBounds")?
        as *const CFDictionary;
    let mut rect = CGRect::default();
    let ok = unsafe { CGRectMakeWithDictionaryRepresentation(Some(&*bounds), &mut rect) };
    if !ok {
        return Err("Invalid window bounds".to_string());
    }
    Ok(rect)
}

#[cfg(target_os = "macos")]
fn cgimage_to_rgba8(
    cg_image: Option<objc2_core_foundation::CFRetained<CGImage>>,
) -> Option<image::RgbaImage> {
    let width = CGImage::width(cg_image.as_deref());
    let height = CGImage::height(cg_image.as_deref());
    let data_provider = CGImage::data_provider(cg_image.as_deref());
    let data = CGDataProvider::data(data_provider.as_deref())?.to_vec();
    let bytes_per_row = CGImage::bytes_per_row(cg_image.as_deref());

    if width == 0 || height == 0 || bytes_per_row < width * 4 {
        return None;
    }

    let mut buffer = Vec::with_capacity(width * height * 4);
    for row in data.chunks_exact(bytes_per_row).take(height) {
        buffer.extend_from_slice(&row[..width * 4]);
    }

    for bgra in buffer.chunks_exact_mut(4) {
        bgra.swap(0, 2);
    }

    image::RgbaImage::from_raw(width as u32, height as u32, buffer)
}
