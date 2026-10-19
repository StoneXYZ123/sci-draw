import { SciVisBench } from "@/components/sci-vis-bench";
import { SCI_VIS_CHART_TYPES, SCI_VIS_JOURNALS, SCI_VIS_LAYOUTS, SCI_VIS_PALETTES, SCI_VIS_WIDTHS } from "@sci-draw/schemas";

export default function SciVisPage() {
  return (
    <SciVisBench
      locale="en"
      chartTypes={SCI_VIS_CHART_TYPES}
      journals={SCI_VIS_JOURNALS}
      palettes={SCI_VIS_PALETTES}
      widths={SCI_VIS_WIDTHS}
      layouts={SCI_VIS_LAYOUTS}
    />
  );
}
