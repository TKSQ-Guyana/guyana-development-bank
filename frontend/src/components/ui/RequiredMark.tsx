/** The red asterisk after a required field's label — one mark for every form
 *  in the portal, so "required" reads the same on each screen. Screen readers
 *  hear "required" instead of "star". */
export function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 text-red-600">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}
