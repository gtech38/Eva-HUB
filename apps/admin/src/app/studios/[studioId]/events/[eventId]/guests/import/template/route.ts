import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET() {
  const csv = toCsv([
    ["household", "first_name", "last_name", "email", "phone", "is_child", "plus_ones", "sub_events"],
    ["The Rao Family", "Lakshmi", "Rao", "lakshmi@example.com", "+15125550101", "", "0", "Haldi;Sangeet;Wedding Ceremony;Reception"],
    ["The Rao Family", "Venkat", "Rao", "", "+15125550102", "", "", "Haldi;Sangeet;Wedding Ceremony;Reception"],
    ["The Rao Family", "Ananya", "Rao", "", "", "yes", "", "Sangeet;Reception"],
    ["Maya Chen", "Maya", "Chen", "maya@example.com", "", "", "1", ""],
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="guests-template.csv"' } });
}
