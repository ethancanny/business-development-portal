import { NextResponse } from "next/server";

// TEMPORARY diagnostic page (Oct 9, 2026): reproduces the Market Intel row
// hover/select pattern in isolation so it can be driven by a real browser
// against the production stack. Delete after diagnosis.
const HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>row highlight repro</title>
<style>body{font-family:sans-serif;background:#f1f5f9}table{background:#fff;border-collapse:collapse}td{padding:8px 12px;font-size:14px;color:#334155}</style>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
<div id="root"></div>
<pre id="status">loading</pre>
<script type="text/babel" data-presets="react">
const { useState } = React;
function App() {
  const dark = false;
  const [selRow, setSelRow] = useState("");
  const toggleRow = (key) => setSelRow((s) => (s === key ? "" : key));
  const [hovRow, setHovRow] = useState("");
  const rowStyle = (key) => ({
    backgroundColor:
      selRow === key
        ? dark ? "rgba(184,151,90,0.28)" : "rgba(13,31,60,0.14)"
        : hovRow === key
          ? dark ? "rgba(255,255,255,0.08)" : "rgba(13,31,60,0.055)"
          : undefined,
    transition: "background-color 200ms ease",
  });
  const rowProps = (key) => ({
    onMouseEnter: () => setHovRow(key),
    onMouseLeave: () => setHovRow((h) => (h === key ? "" : h)),
    onClick: () => toggleRow(key),
    style: rowStyle(key),
    className: "border-b cursor-pointer",
  });
  const rows = ["alpha","beta","gamma","delta"];
  return (
    <table><tbody>
      {rows.map((r) => (
        <tr key={r} {...rowProps("t:" + r)}><td>{r}</td><td>value {r}</td></tr>
      ))}
    </tbody></table>
  );
}
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
setInterval(() => {
  const trs = document.querySelectorAll("tbody tr");
  const parts = [];
  trs.forEach((tr, i) => parts.push("row" + i + "=" + getComputedStyle(tr).backgroundColor));
  document.getElementById("status").textContent = parts.join(" | ");
}, 400);
</script>
</body>
</html>
`;

export async function GET() {
  return new NextResponse(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
