// Custom loader that resolves bare specifiers to .js files
export async function resolve(specifier, context, nextResolve) {
  // Fix react-reconciler/constants → react-reconciler/constants.js
  if (specifier.endsWith('/constants') || specifier.endsWith('/reflection')) {
    return nextResolve(specifier + '.js', context);
  }
  return nextResolve(specifier, context);
}
