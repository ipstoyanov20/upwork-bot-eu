/**
 * Native Browser PDF Export.
 * This approach is superior because:
 * 1. It natively supports modern CSS like "oklab", "oklch", and "color-mix".
 * 2. It produces high-quality, searchable text PDFs (not just an image).
 * 3. It respects @media print CSS rules defined in globals.css.
 */
export async function exportToPdf(elementId: string, filename: string) {
  try {
    // We use the browser's native print capability.
    // The @media print rules in globals.css will take care of hiding the UI 
    // and showing only the #report-content.
    window.print();
  } catch (error) {
    console.error("PDF Export failed:", error);
    alert("Failed to trigger print dialog. Please try using your browser's print function manually.");
  }
}
