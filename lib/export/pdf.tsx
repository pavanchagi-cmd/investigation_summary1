import "server-only";
import path from "node:path";
import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ExportModel } from "./model";

const FONTS = path.join(process.cwd(), "lib", "export", "fonts");
let registered = false;
function registerFonts() {
  if (registered) return;
  Font.register({
    family: "IBM Plex Sans",
    fonts: [
      { src: path.join(FONTS, "ibm-plex-sans-latin-400-normal.woff") },
      { src: path.join(FONTS, "ibm-plex-sans-latin-600-normal.woff"), fontWeight: 600 },
    ],
  });
  Font.register({
    family: "IBM Plex Serif",
    fonts: [
      { src: path.join(FONTS, "ibm-plex-serif-latin-400-normal.woff") },
      { src: path.join(FONTS, "ibm-plex-serif-latin-400-italic.woff"), fontStyle: "italic" },
      { src: path.join(FONTS, "ibm-plex-serif-latin-600-normal.woff"), fontWeight: 600 },
    ],
  });
  Font.register({ family: "IBM Plex Mono", src: path.join(FONTS, "ibm-plex-mono-latin-400-normal.woff") });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 64, paddingHorizontal: 52, fontFamily: "IBM Plex Sans", fontSize: 10, color: "#16202B" },
  title: { fontSize: 18, fontWeight: 600, marginBottom: 10 },
  kv: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#D9DEE5", paddingVertical: 3 },
  k: { width: 120, color: "#4A5565" },
  v: { flex: 1 },
  mono: { fontFamily: "IBM Plex Mono" },
  h2: { fontSize: 9.5, fontWeight: 600, letterSpacing: 0.6, marginTop: 16, marginBottom: 6, textTransform: "uppercase" },
  p: { fontFamily: "IBM Plex Serif", fontSize: 11, lineHeight: 1.55, marginBottom: 6 },
  li: { fontFamily: "IBM Plex Serif", fontSize: 11, lineHeight: 1.5, marginLeft: 10 },
  row: { flexDirection: "row" },
  cell: { flex: 1, borderWidth: 0.5, borderColor: "#D9DEE5", padding: 3, fontSize: 9 },
  decision: { marginTop: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#D9DEE5" },
  footer: { position: "absolute", bottom: 28, left: 52, right: 52, fontSize: 8, color: "#4A5565", flexDirection: "row", justifyContent: "space-between" },
});

export async function buildPdf(x: ExportModel): Promise<Buffer> {
  registerFonts();
  const kv = (k: string, v: string, mono = false) => (
    <View style={s.kv} key={k}>
      <Text style={s.k}>{k}</Text>
      <Text style={mono ? [s.v, s.mono] : s.v}>{v}</Text>
    </View>
  );
  const doc = (
    <Document title={`Investigation summary ${x.alertNumber}`} author={x.analyst} creator="TM Summary Drafter">
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Investigation summary</Text>
        {kv("Alert number", x.alertNumber, true)}
        {kv("Client", x.client)}
        {kv("Review period", x.reviewPeriod)}
        {kv("Analyst", x.analyst)}
        {kv("Approval", x.approvedAt ? `Approved ${x.approvedAt}` : x.status)}
        {kv("Narrative version", `v${x.version}`, true)}
        {x.sections.map((sec, i) => (
          <View key={i}>
            <Text style={s.h2}>{sec.heading}</Text>
            {sec.blocks.map((b, j) =>
              b.kind === "p" ? (
                <Text key={j} style={s.p}>
                  {b.text}
                </Text>
              ) : b.kind === "h3" ? (
                <Text key={j} style={[s.p, { fontFamily: "IBM Plex Sans", fontWeight: 600 }]}>
                  {b.text}
                </Text>
              ) : b.kind === "ul" ? (
                <View key={j} style={{ marginBottom: 6 }}>
                  {b.items.map((it, k) => (
                    <Text key={k} style={s.li}>
                      • {it}
                    </Text>
                  ))}
                </View>
              ) : (
                <View key={j} style={{ marginBottom: 6 }}>
                  {b.rows.map((r, k) => (
                    <View key={k} style={s.row}>
                      {r.map((c, l) => (
                        <Text key={l} style={s.cell}>
                          {c}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}
        <View style={s.decision} wrap={false}>
          <Text style={s.h2}>Disposition</Text>
          <Text style={[s.p, { fontFamily: "IBM Plex Sans", fontWeight: 600 }]}>{x.disposition}</Text>
          <Text style={s.h2}>Rationale</Text>
          <Text style={s.p}>{x.rationale}</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>{x.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
