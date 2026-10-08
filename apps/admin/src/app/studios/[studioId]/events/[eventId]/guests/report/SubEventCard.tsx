import { Card, Table } from "@/components/ui";
import { lt, pct } from "@/lib/format";
import type { ReportAccess, SubEventReport } from "@/lib/guests";

/**
 * One sub-event of the RSVP report. With access "totals" (vendors) it renders counts and meal
 * totals only: no guest names and no link to a name-level CSV, whatever `sub` contains.
 */
export function SubEventCard({ sub, access, exportBase }: { sub: SubEventReport; access: ReportAccess; exportBase: string }) {
  const s = sub.summary;
  const q = `?subEventId=${encodeURIComponent(sub.id)}`;
  const guests = access === "names" ? sub.guests : undefined;
  const responses = access === "names" ? sub.responses : undefined;
  return (
    <Card
      title={lt(sub.name)}
      actions={
        <div className="flex gap-2">
          <a href={`${exportBase}${q}&totals=1`} className="btn-ghost">Meal totals CSV</a>
          {access === "names" && <a href={`${exportBase}${q}`} className="btn-ghost">Guest list CSV</a>}
        </div>
      }
    >
      {responses && (
        <div className="mb-3 grid grid-cols-4 gap-2 text-center">
          <Count n={responses.invited} label="invited" className="bg-neutral-50" />
          <Count n={s.attending} label={`attending (${pct(s.attending, responses.invited)})`} className="bg-green-50 text-green-800" />
          <Count n={responses.declined} label="declined" className="bg-red-50 text-red-800" />
          <Count n={responses.pending} label="pending" className="bg-neutral-50" />
        </div>
      )}
      <div className="text-xs text-neutral-600">{`Attending: ${s.adults} adults · ${s.kids} children`}</div>
      {sub.servesMeal && (
        <>
          <Table head={["Meal", "Adults", "Children", "Total"]} className="mt-3">
            {s.meals.byOption.map((m) => (
              <tr key={m.optionId}>
                <td>{lt(m.label)}{m.isKidsMeal && <span className="ml-1 text-neutral-400">(kids)</span>}</td>
                <td className="tabular-nums">{m.adults}</td>
                <td className="tabular-nums">{m.kids}</td>
                <td className="tabular-nums">{m.total}</td>
              </tr>
            ))}
            <tr className="text-neutral-500">
              <td>No choice yet</td>
              <td className="tabular-nums">{s.meals.noChoice.adults}</td>
              <td className="tabular-nums">{s.meals.noChoice.kids}</td>
              <td className="tabular-nums">{s.meals.noChoice.total}</td>
            </tr>
          </Table>
          <div className="mt-2 text-xs text-neutral-600">{`${s.meals.adultMeals} adult meals · ${s.meals.kidsMeals} kids meals`}</div>
        </>
      )}
      {guests && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-neutral-600">{`Guests (${guests.length})`}</summary>
          <Table head={["Household", "Guest", "Status", "Meal"]} className="mt-2">
            {guests.map((g) => (
              <tr key={g.id}>
                <td>{g.household}</td>
                <td>{g.guest}{g.isChild && <span className="ml-1 text-neutral-400">(child)</span>}</td>
                <td>{g.status}</td>
                <td>{g.meal}</td>
              </tr>
            ))}
          </Table>
        </details>
      )}
    </Card>
  );
}

function Count({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <div className={`rounded p-2 ${className}`}>
      <div className="text-lg font-semibold tabular-nums">{n}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
