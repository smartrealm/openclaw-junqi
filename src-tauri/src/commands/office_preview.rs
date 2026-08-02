//! Read-only textual previews for OOXML files produced in chat workspaces.
//!
//! OOXML packages are ZIP archives. We intentionally extract only text and
//! spreadsheet cell values; this never runs embedded macros, scripts, or links.

use quick_xml::{events::Event, Reader, XmlVersion};
use serde::Serialize;
use std::{collections::BTreeMap, fs::File, io::Read};
use zip::ZipArchive;

const MAX_OFFICE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_OFFICE_ENTRY_BYTES: u64 = 768 * 1024;
const MAX_PREVIEW_CHARS: usize = 512 * 1024;
const MAX_PRESENTATION_SLIDES: usize = 100;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficePreviewResult {
    pub success: bool,
    pub format: Option<String>,
    pub content: Option<String>,
    pub truncated: bool,
    pub error: Option<String>,
}

fn failure(error: impl Into<String>) -> OfficePreviewResult {
    OfficePreviewResult {
        success: false,
        format: None,
        content: None,
        truncated: false,
        error: Some(error.into()),
    }
}

fn text_nodes(xml: &str, tag: &[u8]) -> Result<Vec<String>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut depth = 0usize;
    let mut values = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) if event.name().as_ref() == tag => depth += 1,
            Ok(Event::End(event)) if event.name().as_ref() == tag && depth > 0 => depth -= 1,
            Ok(Event::Text(event)) if depth > 0 => values.push(
                event
                    .xml_content(XmlVersion::Implicit1_0)
                    .map_err(|error| error.to_string())?
                    .into_owned(),
            ),
            Ok(Event::CData(event)) if depth > 0 => values.push(
                event
                    .xml_content(XmlVersion::Implicit1_0)
                    .map_err(|error| error.to_string())?
                    .into_owned(),
            ),
            Ok(Event::Eof) => break,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
    }
    Ok(values)
}

fn zip_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Option<String>, String> {
    let Ok(entry) = archive.by_name(name) else {
        return Ok(None);
    };
    if entry.size() > MAX_OFFICE_ENTRY_BYTES {
        return Err("An Office preview entry is too large".to_string());
    }
    let mut xml = String::new();
    entry
        .take(MAX_OFFICE_ENTRY_BYTES + 1)
        .read_to_string(&mut xml)
        .map_err(|error| error.to_string())?;
    if xml.len() > MAX_OFFICE_ENTRY_BYTES as usize {
        return Err("An Office preview entry is too large".to_string());
    }
    Ok(Some(xml))
}

fn column_index(cell_ref: &str) -> usize {
    cell_ref
        .bytes()
        .take_while(|byte| byte.is_ascii_alphabetic())
        .fold(0usize, |value, byte| {
            value * 26 + (byte.to_ascii_uppercase() - b'A' + 1) as usize
        })
        .saturating_sub(1)
}

fn spreadsheet_preview(archive: &mut ZipArchive<File>) -> Result<String, String> {
    let shared_strings = zip_entry(archive, "xl/sharedStrings.xml")?
        .map(|xml| text_nodes(&xml, b"t"))
        .transpose()?
        .unwrap_or_default();
    let sheet = zip_entry(archive, "xl/worksheets/sheet1.xml")?
        .ok_or_else(|| "The workbook has no first worksheet".to_string())?;
    let mut reader = Reader::from_str(&sheet);
    reader.config_mut().trim_text(true);
    let mut cells: BTreeMap<usize, BTreeMap<usize, String>> = BTreeMap::new();
    let mut current: Option<(usize, usize, bool, String)> = None;
    let mut in_value = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) if event.name().as_ref() == b"c" => {
                let mut reference = None;
                let mut shared = false;
                for attribute in event.attributes().flatten() {
                    if attribute.key.as_ref() == b"r" {
                        reference =
                            Some(String::from_utf8_lossy(attribute.value.as_ref()).into_owned());
                    } else if attribute.key.as_ref() == b"t" {
                        shared = attribute.value.as_ref() == b"s";
                    }
                }
                if let Some(reference) = reference {
                    let row = reference
                        .bytes()
                        .skip_while(|byte| byte.is_ascii_alphabetic())
                        .collect::<Vec<_>>();
                    let row = std::str::from_utf8(&row)
                        .ok()
                        .and_then(|value| value.parse::<usize>().ok());
                    if let Some(row) = row {
                        current = Some((row, column_index(&reference), shared, String::new()));
                    }
                }
            }
            Ok(Event::Start(event))
                if event.name().as_ref() == b"v" || event.name().as_ref() == b"t" =>
            {
                in_value = true
            }
            Ok(Event::End(event))
                if event.name().as_ref() == b"v" || event.name().as_ref() == b"t" =>
            {
                in_value = false
            }
            Ok(Event::Text(event)) if in_value => {
                if let Some((_, _, _, value)) = current.as_mut() {
                    value.push_str(
                        &event
                            .xml_content(XmlVersion::Implicit1_0)
                            .map_err(|error| error.to_string())?,
                    );
                }
            }
            Ok(Event::End(event)) if event.name().as_ref() == b"c" => {
                if let Some((row, column, shared, value)) = current.take() {
                    let value = if shared {
                        value
                            .parse::<usize>()
                            .ok()
                            .and_then(|index| shared_strings.get(index))
                            .cloned()
                            .unwrap_or(value)
                    } else {
                        value
                    };
                    if !value.is_empty() {
                        cells.entry(row).or_default().insert(column, value);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
    }
    let mut output = String::new();
    for (_, row) in cells {
        let last = row.keys().last().copied().unwrap_or(0);
        for column in 0..=last {
            if column > 0 {
                output.push('\t');
            }
            output.push_str(row.get(&column).map(String::as_str).unwrap_or(""));
        }
        output.push('\n');
        if output.len() >= MAX_PREVIEW_CHARS {
            break;
        }
    }
    Ok(output)
}

fn presentation_preview(archive: &mut ZipArchive<File>) -> Result<String, String> {
    let mut slide_names = archive
        .file_names()
        .filter(|name| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
        .take(MAX_PRESENTATION_SLIDES + 1)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if slide_names.len() > MAX_PRESENTATION_SLIDES {
        return Err("The presentation has too many slides to preview".to_string());
    }
    slide_names.sort_by_key(|name| {
        name.trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<usize>()
            .unwrap_or(usize::MAX)
    });
    let mut output = String::new();
    for (index, name) in slide_names.iter().enumerate() {
        let Some(xml) = zip_entry(archive, name)? else {
            continue;
        };
        let content = text_nodes(&xml, b"a:t")?.join("\n");
        if content.is_empty() {
            continue;
        }
        output.push_str(&format!("--- {} ---\n{}\n\n", index + 1, content));
        if output.len() >= MAX_PREVIEW_CHARS {
            break;
        }
    }
    Ok(output)
}

fn document_preview(archive: &mut ZipArchive<File>) -> Result<String, String> {
    let xml = zip_entry(archive, "word/document.xml")?
        .ok_or_else(|| "The document has no body".to_string())?;
    Ok(text_nodes(&xml, b"w:t")?.join(""))
}

fn read_office_preview_sync(path: String, workspace_root: String) -> OfficePreviewResult {
    let file_path =
        match crate::commands::fs_neu::validate_path_within(&path, &workspace_root, false) {
            Ok(path) => path,
            Err(_) => return failure("The output file is outside the selected workspace"),
        };
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = match extension.as_str() {
        "xlsx" => "spreadsheet",
        "pptx" => "presentation",
        "docx" => "document",
        _ => return failure("This Office format has no built-in preview"),
    };
    let metadata = match file_path.metadata() {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return failure("The output file is unavailable"),
    };
    if metadata.len() > MAX_OFFICE_BYTES {
        return failure("The Office file is too large to preview");
    }
    let file = match File::open(&file_path) {
        Ok(file) => file,
        Err(error) => return failure(format!("Unable to read the Office file: {error}")),
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => return failure("The Office file is not a readable OOXML package"),
    };
    let content = match format {
        "spreadsheet" => spreadsheet_preview(&mut archive),
        "presentation" => presentation_preview(&mut archive),
        "document" => document_preview(&mut archive),
        _ => unreachable!(),
    };
    match content {
        Ok(mut content) => {
            let truncated = content.len() > MAX_PREVIEW_CHARS;
            content.truncate(MAX_PREVIEW_CHARS);
            OfficePreviewResult {
                success: true,
                format: Some(format.to_string()),
                content: Some(content),
                truncated,
                error: None,
            }
        }
        Err(error) => failure(error),
    }
}

#[tauri::command]
pub async fn read_office_preview(path: String, workspace_root: String) -> OfficePreviewResult {
    match tauri::async_runtime::spawn_blocking(move || {
        read_office_preview_sync(path, workspace_root)
    })
    .await
    {
        Ok(result) => result,
        Err(_) => failure("The Office preview task did not complete"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        presentation_preview, read_office_preview_sync, spreadsheet_preview, MAX_OFFICE_ENTRY_BYTES,
    };
    use std::{fs::File, io::Write, path::PathBuf};
    use uuid::Uuid;
    use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

    fn archive(entries: &[(&str, &str)]) -> (PathBuf, ZipArchive<File>) {
        let path =
            std::env::temp_dir().join(format!("junqi-office-preview-{}.zip", Uuid::new_v4()));
        let file = File::create(&path).expect("create test archive");
        let mut writer = ZipWriter::new(file);
        for (name, content) in entries {
            writer
                .start_file(name, SimpleFileOptions::default())
                .expect("start archive entry");
            writer
                .write_all(content.as_bytes())
                .expect("write archive entry");
        }
        writer.finish().expect("finish archive");
        let file = File::open(&path).expect("reopen test archive");
        (path, ZipArchive::new(file).expect("open test archive"))
    }

    #[test]
    fn spreadsheet_preview_resolves_shared_strings_and_cells() {
        let (path, mut archive) = archive(&[
            ("xl/sharedStrings.xml", "<sst><si><t>Month</t></si><si><t>January</t></si></sst>"),
            ("xl/worksheets/sheet1.xml", "<worksheet><sheetData><row><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\"><v>100</v></c></row><row><c r=\"A2\" t=\"s\"><v>1</v></c></row></sheetData></worksheet>"),
        ]);
        assert_eq!(
            spreadsheet_preview(&mut archive).expect("parse workbook"),
            "Month\t100\nJanuary\n"
        );
        std::fs::remove_file(path).expect("remove test archive");
    }

    #[test]
    fn presentation_preview_keeps_slide_order_and_text() {
        let (path, mut archive) = archive(&[
            ("ppt/slides/slide2.xml", "<p:sld><a:t>Second</a:t></p:sld>"),
            ("ppt/slides/slide1.xml", "<p:sld><a:t>First</a:t></p:sld>"),
        ]);
        assert_eq!(
            presentation_preview(&mut archive).expect("parse slides"),
            "--- 1 ---\nFirst\n\n--- 2 ---\nSecond\n\n"
        );
        std::fs::remove_file(path).expect("remove test archive");
    }

    #[test]
    fn preview_refuses_a_path_outside_the_selected_workspace() {
        let workspace = std::env::temp_dir().join(format!("junqi-office-root-{}", Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("junqi-office-outside-{}.docx", Uuid::new_v4()));
        std::fs::create_dir(&workspace).expect("create workspace");
        std::fs::write(&outside, b"not an office document").expect("write outside file");

        let result = read_office_preview_sync(
            outside.to_string_lossy().to_string(),
            workspace.to_string_lossy().to_string(),
        );
        assert!(!result.success);
        assert_eq!(
            result.error.as_deref(),
            Some("The output file is outside the selected workspace")
        );

        std::fs::remove_file(outside).expect("remove outside file");
        std::fs::remove_dir(workspace).expect("remove workspace");
    }

    #[test]
    fn preview_refuses_an_oversized_uncompressed_zip_entry() {
        let oversized = "x".repeat(MAX_OFFICE_ENTRY_BYTES as usize + 1);
        let (path, mut archive) = archive(&[("xl/worksheets/sheet1.xml", oversized.as_str())]);
        let error = spreadsheet_preview(&mut archive).expect_err("reject oversized entry");
        assert_eq!(error, "An Office preview entry is too large");
        std::fs::remove_file(path).expect("remove test archive");
    }
}
