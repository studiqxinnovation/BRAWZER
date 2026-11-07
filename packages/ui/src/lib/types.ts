/**
 * Base UI accepts `className` as a string or a function of component state.
 * Brawzer components merge class names, so they accept strings only.
 */
export type WithClassName<Props> = Omit<Props, "className"> & { className?: string };
