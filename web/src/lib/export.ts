import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import { saveAs } from "file-saver";

export async function exportToDocx(analysis: any, callMetadata: any) {
  if (!analysis) return;

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: analysis.part_a?.title || "EU Project Proposal Draft",
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: `Topic: ${callMetadata?.topicCode || "N/A"}`,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),

          // PART A
          new Paragraph({ text: "Part A: Project Summary", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Paragraph({ text: "Objectives", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: String(analysis.part_a?.objectives || ""), spacing: { after: 200 } }),
          new Paragraph({ text: "Concept & Approach", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: String(analysis.part_a?.concept || ""), spacing: { after: 200 } }),
          new Paragraph({ text: "Consortium Added Value", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: String(analysis.part_a?.value || ""), spacing: { after: 200 } }),

          // CONSORTIUM
          new Paragraph({ text: "Consortium & Roles", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          ...((analysis.consortium_roles || []).map((p: any) => [
            new Paragraph({ text: p.name, heading: HeadingLevel.HEADING_2 }),
            new Paragraph({
              children: [
                new TextRun({ text: "Role: ", bold: true }),
                new TextRun(p.role || ""),
              ]
            }),
            new Paragraph({ 
              children: [new TextRun({ text: "Responsibilities:", bold: true })] 
            }),
            new Paragraph({ text: p.responsibilities || "" }),
            new Paragraph({ text: `Effort: ${p.effort}`, spacing: { after: 200 } }),
          ]).flat()),

          // BUDGET
          new Paragraph({ text: "Budget Allocation Proposal", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Partner", bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Share (%)", bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Amount (€)", bold: true })] })] }),
                ]
              }),
              ...(analysis.budget || []).map((b: any) => new TableRow({
                children: [
                   new TableCell({ children: [new Paragraph(b.name || "")] }),
                   new TableCell({ children: [new Paragraph(b.share || "")] }),
                   new TableCell({ children: [new Paragraph(b.amountFormatted || b.amount || "")] }),
                ]
              }))
            ]
          }),

          // PART B
          new Paragraph({ text: "Part B: Detailed Project Description", heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } }),
          ...Object.entries(analysis.part_b || {}).map(([key, value]) => [
            new Paragraph({ text: key.replace(/_/g, ' ').toUpperCase(), heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }),
            new Paragraph({ text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }),
          ]).flat()
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${(analysis.part_a?.title || "proposal").substring(0, 30)}.docx`);
}
