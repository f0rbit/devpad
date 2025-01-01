// takes an array of HistoryAction[], draws a timeline of them.
// we want to add pagination as well.
// using solidjs
import { createSignal, For } from "solid-js";
import type { HistoryAction } from "../../server/types";
import type { ActionType } from "../../../database/schema";
import ScanText from "lucide-solid/icons/scan-text";

const pageSize = () => 10;

export default function HistoryTimeline(props: { actions: HistoryAction[] }) {
  // duplicate the actions x30 for testing
  const actions = props.actions.flatMap((action) => Array(50).fill(action));
  const [page, setPage] = createSignal(0);

  const pageCount = () => Math.ceil(actions.length / pageSize());


  const PageControls = () => {

    const renderPageNumbers = () => {
      const currentPage = page();
      const totalPages = pageCount();
      const maxVisiblePages = 5;
      const pageNumbers: (number | "...")[] = [];

      if (totalPages <= maxVisiblePages) {
        for (let i = 0; i < totalPages; i++) {
          pageNumbers.push(i);
        }
      } else {
        if (currentPage <= 2) {
          for (let i = 0; i < Math.min(maxVisiblePages - 1, totalPages); i++) {
            pageNumbers.push(i);
          }
          if (totalPages > maxVisiblePages) {
            pageNumbers.push("...");
            pageNumbers.push(totalPages - 1);
          }
        } else if (currentPage >= totalPages - 3) {
          pageNumbers.push(0);
          pageNumbers.push("...");
          for (let i = totalPages - maxVisiblePages + 1; i < totalPages; i++) {
            pageNumbers.push(i);
          }
        } else {
          pageNumbers.push(0);
          pageNumbers.push("...");
          for (let i = currentPage - 1; i <= currentPage + 1; i++) {
            pageNumbers.push(i);
          }
          pageNumbers.push("...");
          pageNumbers.push(totalPages - 1);
        }
      }

      return pageNumbers;
    };

    return (
      <div class="flex-row icons">
        {renderPageNumbers().map((item) => (
          <a
            href="#"
            class={item === page() ? "active" : ""}
            onClick={() => typeof item === "number" && setPage(item)}
          >
            {item === "..." ? "..." : item + 1}
          </a>
        ))}
      </div>
    );
  };

  return (
    <div class="flex-col">
      <div class="timeline-container">
        <For each={actions.slice(page() * pageSize(), page() * pageSize() + pageSize())}>
          {(action) => <TimelineItem action={action} />}
        </For>
      </div>
      <div>
        <div class="flex-col">
          <PageControls />
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ action }: { action: HistoryAction }) {

  const ActionDate = () => {
    // format it like YYYY/MM/DD 08:15 PM
    // and the time needs to be converted to local timezone.
    // use Intl.DateTimeFormat to do this.
    const date = new Date(action.created_at);
    const dateString = date.toLocaleDateString("en-AU", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });

    const timeString = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });

    return (
      <div class="date-highlighted flex-row" style={{ "color": "var(--text-tertiary)" }}>
        <div class="date">{timeString}</div>
        <div class="year">{dateString}</div>
      </div>
    );
  };

  const ActionIcon = ({ type }: { type: HistoryAction['type'] }) => {
    switch (type) {
      case "SCAN":
        return <ScanText />;
      default:
        return <span>?</span>;
    }
  };

  return (
    <div class="timeline-item">
      <div class="flex-row">
        <ActionIcon type={action.type} />
        <ActionDate />
      </div>
      <div>
        {action.description}
      </div>
    </div>
  );
}
