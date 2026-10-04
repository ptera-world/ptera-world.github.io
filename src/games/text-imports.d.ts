/** Files imported with `with { type: "text" }` are bundled as strings. */
declare module "*.css" {
  const text: string;
  export default text;
}
