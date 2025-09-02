import React from "react"
// Lazy import pattern: keep types even if Recharts not installed yet
import {
  ResponsiveContainer,
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"

export type ChartSpec = {
  type: "chart"
  chart: "bar" | "line"
  title?: string
  xKey: string
  yKey: string
  data: Array<Record<string, string | number>>
}

type Props = {
  spec: ChartSpec
  height?: number
}

export const ChartRenderer: React.FC<Props> = ({ spec, height = 280 }) => {
  const { chart, xKey, yKey, data } = spec
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div style={{ width: "100%", height }} className="flex items-center justify-center text-ui-fg-subtle">
        No data to display for the selected period.
      </div>
    )
  }
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={xKey} />
      <YAxis />
      <Tooltip />
    </>
  )

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        {chart === "bar" ? (
          <BarChart data={data}>
            {common}
            <Bar dataKey={yKey} fill="#6366f1" />
          </BarChart>
        ) : (
          <LineChart data={data}>
            {common}
            <Line type="monotone" dataKey={yKey} stroke="#6366f1" strokeWidth={2} dot={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export default ChartRenderer
