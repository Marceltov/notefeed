// What a feed the operator removed answers under its name and its read id (issue #155): never an empty feed, never a compose box.
export function Removed() {
  return (
    <p role="status" className="text-muted">
      This feed was removed by the operator. Its name and its read link cannot be used again.
    </p>
  );
}
