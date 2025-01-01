// takes an array of HistoryAction[], draws a timeline of them.
// we want to add pagination as well.
// using solidjs
import { createSignal, For } from "solid-js";
import type { HistoryAction } from "../../server/types";

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
          {(action) => (
            <div class="timeline-item">
              <div>
                {action.created_at}
              </div>
              <div>
                {action.type}
              </div>
              <div>
                {action.description}
              </div>
            </div>
          )}
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
