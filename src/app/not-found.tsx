import { ErrorFrame } from "@/components/ErrorFrame";

export const metadata = { title: "Not found · Lookout" };

/** Any URL that matches no page, or a page that calls notFound() (#396). */
export default function NotFound() {
  return (
    <ErrorFrame eyebrow="404" title="This page isn't here">
      <p style={{ margin: 0 }}>The link may be old, or the page may have moved. If you followed a link from an email, the find may have been removed.</p>
    </ErrorFrame>
  );
}
