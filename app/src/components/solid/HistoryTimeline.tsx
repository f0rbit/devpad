// takes an array of HistoryAction[], draws a timeline of them.
// we want to add pagination as well.
// using solidjs
import { createSignal, For } from "solid-js";
import type { HistoryAction } from "../../server/types";
import ScanText from "lucide-solid/icons/scan-text";
import FolderPen from "lucide-solid/icons/folder-pen";
import FolderPlus from "lucide-solid/icons/folder-plus";
import FolderMinus from "lucide-solid/icons/folder-minus";
import FilePlus2 from "lucide-solid/icons/file-plus-2";
import FilePen from "lucide-solid/icons/file-pen";
import FileMinus2 from "lucide-solid/icons/file-minus-2";

const pageSize = () => 10;

export default function HistoryTimeline(props: { actions: HistoryAction[] }) {
  // duplicate the actions x30 for testing
  const actions = props.actions;
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
            role="button"
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
    // Ensure 'action' is passed as a prop
    if (!action || !action.created_at) {
      return null; // Handle the case where action or created_at is undefined
    }

    // Parse the UTC date and convert it to a Date object
    const utcDate = new Date(action.created_at + "Z");

    // Automatically detect the user's locale
    const userLocale = navigator.language || "en-US";

    // Format the date and time in the user's locale and convert it to local timezone
    const dateString = new Intl.DateTimeFormat(userLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(utcDate);

    const timeString = new Intl.DateTimeFormat(userLocale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).format(utcDate);

    return (
      <div class="date-highlighted flex-row" style={{ color: "var(--text-tertiary)" }}>
        <div class="date">{timeString}</div>
        <div class="year">{dateString}</div>
      </div>
    );
  };

  const ActionIcon = ({ type }: { type: HistoryAction['type'] }) => {
    switch (type) {
      case "SCAN":
        return <ScanText />;
      case "UPDATE_PROJECT":
        return <FolderPen />;
      case "CREATE_PROJECT":
        return <FolderPlus />;
      case "DELETE_PROJECT":
        return <FolderMinus />;
      case "CREATE_TASK":
        return <FilePlus2 />;
      case "UPDATE_TASK":
        return <FilePen />;
      case "DELETE_TASK":
        return <FileMinus2 />;
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
