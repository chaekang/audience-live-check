import type { ReactElement } from "react";
import { useCheckIn } from "./use-check-in";
import "./styles.css";

export function CheckInApp(): ReactElement {
  const {
    demoLoad,
    status,
    message,
    servedBy,
    start,
    startDemoLoad,
    stopDemoLoad,
  } = useCheckIn();
  const isButtonDisabled = status === "starting";
  const statusLabel =
    status === "starting"
      ? "참여 시작 중"
      : status === "active"
        ? "✓ 참여 중 · 연결됨"
        : status === "completed"
          ? "✓ 참여 완료"
          : null;

  return (
    <main className="page-shell">
      <section
        className="check-in-panel"
        aria-labelledby="service-title"
        data-served-by={
          import.meta.env.DEV ? (servedBy ?? undefined) : undefined
        }
      >
        <p className="eyebrow">LIVE CHECK-IN</p>
        <h1 id="service-title">데모에 참여해 주세요.</h1>
        <button
          className="check-in-button"
          type="button"
          disabled={isButtonDisabled}
          onClick={start}
        >
          {status === "starting"
            ? "연결 중"
            : status === "active"
              ? "한 번 더 참여하기"
              : status === "completed"
                ? "한 번 더 참여하기"
                : "참여하기"}
        </button>
        {demoLoad.available ? (
          <div className="demo-load-control">
            <button
              aria-label={"AI \uacbd\uace0 \ub370\ubaa8 \u00b7 24\uac74"}
              className="demo-load-button"
              disabled={demoLoad.status === "running"}
              onClick={() => startDemoLoad("warning")}
              type="button"
            >
              {"AI \uacbd\uace0 \ub370\ubaa8 \u00b7 24\uac74"}
            </button>
            <button
              aria-label={
                "Fargate \ud655\uc7a5 \uac80\uc99d \u00b7 \ucd5c\ub300 5 RPS \u00b7 900\uac74"
              }
              className="demo-load-button"
              disabled={demoLoad.status === "running"}
              onClick={() => {
                if (
                  window.confirm(
                    "900\uac74\uc758 \uc2e4\uc81c \ucc38\uc5ec \uc694\uccad\uc744 \uc21c\ucc28\uc801\uc73c\ub85c \ubcf4\ub0c5\ub2c8\ub2e4. \ubc1c\ud45c\uc6a9 \ud658\uacbd\uc5d0\uc11c\ub9cc \uc2e4\ud589\ud560\uae4c\uc694?",
                  )
                ) {
                  startDemoLoad("scaleOut");
                }
              }}
              type="button"
            >
              {
                "Fargate \ud655\uc7a5 \uac80\uc99d \u00b7 \ucd5c\ub300 5 RPS \u00b7 900\uac74"
              }
            </button>
            {demoLoad.status === "running" ? (
              <>
                <p role="status">
                  {"\ubd80\ud558 \uc0dd\uc131 "}
                  {[demoLoad.attempted, demoLoad.target].join("/")}
                </p>
                <button
                  className="demo-load-stop-button"
                  onClick={stopDemoLoad}
                  type="button"
                >
                  {"\ubd80\ud558 \uc911\ub2e8"}
                </button>
              </>
            ) : demoLoad.status === "completed" ? (
              <p role="status">
                {"\uad00\uce21 \uc2e0\ud638 "}
                {demoLoad.observed}
                {"\uac74 \uc804\uc1a1 \uc644\ub8cc"}
              </p>
            ) : demoLoad.status === "partial" ? (
              <p role="alert">
                {"\uad00\uce21 \uc2e0\ud638 "}
                {demoLoad.observed}
                {"/"}
                {demoLoad.target}
                {"\uac74 \uc804\uc1a1 \u00b7 \uc694\uccad \uc131\uacf5 "}
                {demoLoad.succeeded}
                {"\uac74 \u00b7 \uc2e4\ud328 "}
                {demoLoad.failed}
                {"\uac74"}
              </p>
            ) : demoLoad.status === "error" ? (
              <p role="alert">
                {
                  "\uad00\uce21 \uc5f0\uacb0\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694."
                }
              </p>
            ) : null}
          </div>
        ) : null}
        {statusLabel !== null ? (
          <div
            className="status-message status-success"
            role="status"
            aria-live="polite"
          >
            <strong>{statusLabel}</strong>
            <span>{message}</span>
          </div>
        ) : status === "error" ? (
          <div
            className="status-message status-error"
            role="alert"
            aria-live="assertive"
          >
            <strong>참여하지 못했습니다</strong>
            <span>{message}</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}
