interface GitHubMarkProps {
  className?: string;
}

export function GitHubMark({ className }: GitHubMarkProps) {
  return (
    <svg
      className={["github-mark", className ?? ""].filter(Boolean).join(" ")}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 .2a7.8 7.8 0 0 0-2.47 15.2c.39.08.53-.17.53-.37v-1.5c-2.17.47-2.63-.92-2.63-.92-.36-.9-.87-1.14-.87-1.14-.71-.48.05-.47.05-.47.79.05 1.2.81 1.2.81.7 1.2 1.84.86 2.29.66.07-.5.28-.86.5-1.06-1.73-.2-3.55-.87-3.55-3.85 0-.85.31-1.55.8-2.09-.08-.2-.35-1 .08-2.07 0 0 .65-.21 2.14.8A7.4 7.4 0 0 1 8 2.76c.66 0 1.33.09 1.95.27 1.48-1 2.13-.8 2.13-.8.43 1.07.16 1.87.08 2.07.5.54.8 1.24.8 2.09 0 2.99-1.82 3.65-3.56 3.85.28.24.53.69.53 1.39v2.07c0 .2.14.45.54.37A7.8 7.8 0 0 0 8 .2Z"
      />
    </svg>
  );
}
