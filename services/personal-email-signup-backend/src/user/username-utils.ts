/**
 * Username Utilities
 *
 * Utility functions and constants for username validation and management.
 * This includes reserved usernames, normalization, and validation functions.
 *
 * TODO: Extend with actual username management features
 * - Add more comprehensive reserved username list
 * - Implement advanced normalization rules
 * - Add unicode support for international usernames
 * - Implement username suggestion algorithms
 *
 * Consumers: Username controllers, validation services
 * Priority: High (username management)
 */

// Import existing normalization functions
import { normalizeUsername, isValidUsernameForm } from "./username-normalize";

// Re-export for convenience
export { normalizeUsername, isValidUsernameForm } from "./username-normalize";

/**
 * Set of reserved usernames that cannot be used by regular users
 */
export const RESERVED_USERNAMES = new Set([
  // System accounts
  "admin",
  "administrator",
  "root",
  "system",
  "daemon",
  "service",
  "support",
  "help",
  "contact",
  "info",
  "service",
  "team",

  // Common service names
  "api",
  "www",
  "mail",
  "email",
  "smtp",
  "pop",
  "imap",
  "ftp",
  "ssh",
  "telnet",
  "dns",
  "dhcp",
  "ntp",
  "ldap",
  "sql",

  // Application specific
  "user",
  "users",
  "account",
  "accounts",
  "profile",
  "profiles",
  "auth",
  "authentication",
  "login",
  "signup",
  "register",
  "dashboard",
  "settings",
  "config",
  "configuration",

  // Common names that might cause confusion
  "test",
  "testing",
  "demo",
  "example",
  "sample",
  "placeholder",
  "default",
  "anonymous",
  "guest",
  "public",
  "private",

  // Inappropriate or problematic
  "fuck",
  "shit",
  "damn",
  "hell",
  "bitch",
  "asshole",
  "bastard",
  "nazi",
  "hitler",
  "terrorist",
  "spam",
  "scam",
  "phishing",

  // Common tech terms
  "null",
  "undefined",
  "void",
  "true",
  "false",
  "none",
  "nil",
  "empty",
  "blank",
  "space",
  "tab",
  "newline",
  "return",

  // Social media platforms
  "facebook",
  "twitter",
  "instagram",
  "youtube",
  "tiktok",
  "linkedin",
  "snapchat",
  "reddit",
  "discord",
  "twitch",

  // Brand protection
  "google",
  "microsoft",
  "apple",
  "amazon",
  "meta",
  "netflix",
  "spotify",
  "paypal",
  "visa",
  "mastercard",
  "amex",

  // File system reserved
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "lpt1",
  "lpt2",
  "lpt3",
  "clock$",

  // Common variations
  "about",
  "abuse",
  "access",
  "account",
  "accounts",
  "add",
  "address",
  "adm",
  "admin",
  "administration",
  "adult",
  "advertising",
  "affiliate",
  "affiliates",
  "ajax",
  "analytics",
  "android",
  "anon",
  "anonymous",
  "api",
  "app",
  "apps",
  "archive",
  "atom",
  "auth",
  "authentication",
  "avatar",
  "backup",
  "banner",
  "banners",
  "bin",
  "billing",
  "blog",
  "blogs",
  "board",
  "bot",
  "bots",
  "business",
  "cal",
  "calendar",
  "call",
  "campaign",
  "cancel",
  "captcha",
  "career",
  "careers",
  "cart",
  "cats",
  "cgi",
  "cgi-bin",
  "chat",
  "check",
  "checking",
  "checkout",
  "client",
  "clients",
  "code",
  "compare",
  "config",
  "connect",
  "contact",
  "contest",
  "cookies",
  "copy",
  "copyright",
  "count",
  "counter",
  "css",
  "csv",
  "cvs",
  "data",
  "database",
  "db",
  "delete",
  "demo",
  "design",
  "designer",
  "dev",
  "devel",
  "dir",
  "directory",
  "doc",
  "docs",
  "domain",
  "download",
  "downloads",
  "edit",
  "editor",
  "email",
  "ecommerce",
  "employment",
  "empty",
  "end",
  "enterprise",
  "entries",
  "entry",
  "error",
  "errors",
  "eval",
  "event",
  "exit",
  "explore",
  "export",
  "facebook",
  "faq",
  "favorite",
  "feed",
  "feedback",
  "file",
  "files",
  "filter",
  "flash",
  "fleet",
  "fleets",
  "flog",
  "folk",
  "follow",
  "font",
  "fonts",
  "forgot",
  "form",
  "forum",
  "forums",
  "founder",
  "free",
  "friend",
  "ftp",
  "gadget",
  "gadgets",
  "game",
  "games",
  "get",
  "gift",
  "gifts",
  "gist",
  "github",
  "guest",
  "guests",
  "help",
  "home",
  "homepage",
  "host",
  "hosting",
  "hostname",
  "html",
  "http",
  "httpd",
  "https",
  "i",
  "iamges",
  "icon",
  "icons",
  "id",
  "idea",
  "ideas",
  "image",
  "images",
  "imap",
  "img",
  "index",
  "indice",
  "info",
  "information",
  "inquiry",
  "intranet",
  "invite",
  "ipad",
  "iphone",
  "irc",
  "is",
  "issue",
  "issues",
  "it",
  "item",
  "items",
  "java",
  "javascript",
  "job",
  "jobs",
  "js",
  "json",
  "jump",
  "keyword",
  "keywords",
  "landing",
  "last",
  "ldap",
  "legal",
  "license",
  "link",
  "links",
  "linux",
  "list",
  "lists",
  "log",
  "login",
  "logout",
  "logs",
  "mac",
  "mail",
  "mail1",
  "mail2",
  "mail3",
  "mail4",
  "mail5",
  "mailer",
  "mailing",
  "mailman",
  "manager",
  "marketing",
  "master",
  "me",
  "media",
  "member",
  "members",
  "memory",
  "message",
  "messages",
  "messenger",
  "mine",
  "mis",
  "mob",
  "mobile",
  "movie",
  "movies",
  "mp3",
  "msg",
  "msn",
  "mysql",
  "name",
  "named",
  "net",
  "network",
  "new",
  "news",
  "newsletter",
  "nick",
  "nickname",
  "notes",
  "noticias",
  "notification",
  "notify",
  "ns",
  "ns1",
  "ns2",
  "ns3",
  "ns4",
  "old",
  "online",
  "operator",
  "order",
  "orders",
  "organization",
  "organizations",
  "page",
  "pager",
  "pages",
  "panel",
  "password",
  "perl",
  "php",
  "pic",
  "pics",
  "ping",
  "policy",
  "pop",
  "pop3",
  "post",
  "postfix",
  "postmaster",
  "posts",
  "pr",
  "prefs",
  "premium",
  "press",
  "price",
  "pricing",
  "privacy",
  "private",
  "profile",
  "project",
  "projects",
  "promo",
  "pub",
  "public",
  "python",
  "random",
  "rank",
  "recipe",
  "recipes",
  "redirect",
  "ref",
  "refund",
  "refunds",
  "release",
  "remove",
  "request",
  "requests",
  "reset",
  "resolver",
  "respond",
  "return",
  "returns",
  "review",
  "reviews",
  "root",
  "router",
  "rss",
  "ruby",
  "rule",
  "rules",
  "sale",
  "sales",
  "sample",
  "samples",
  "script",
  "scripts",
  "search",
  "secure",
  "security",
  "self",
  "sell",
  "send",
  "service",
  "services",
  "session",
  "sessions",
  "setting",
  "settings",
  "setup",
  "share",
  "shared",
  "shell",
  "shop",
  "shopping",
  "signin",
  "signup",
  "site",
  "sitemap",
  "sites",
  "smtp",
  "sql",
  "ssh",
  "ssl",
  "stage",
  "staging",
  "start",
  "stat",
  "static",
  "stats",
  "status",
  "store",
  "stores",
  "style",
  "styles",
  "stylesheet",
  "stylesheets",
  "subdomain",
  "subscribe",
  "subscriptions",
  "suporte",
  "support",
  "survey",
  "sync",
  "system",
  "tablet",
  "tablets",
  "tag",
  "tags",
  "talk",
  "task",
  "tasks",
  "tech",
  "telnet",
  "terms",
  "test",
  "test1",
  "test2",
  "test3",
  "teste",
  "testing",
  "tests",
  "theme",
  "themes",
  "thread",
  "threads",
  "tmp",
  "todo",
  "tools",
  "top",
  "topic",
  "topics",
  "tos",
  "tour",
  "tutorial",
  "tutorials",
  "tv",
  "twitter",
  "undef",
  "unsubscribe",
  "update",
  "updates",
  "upload",
  "uploads",
  "url",
  "usage",
  "user",
  "username",
  "users",
  "validation",
  "validations",
  "video",
  "videos",
  "visitor",
  "watch",
  "web",
  "webmail",
  "webmaster",
  "website",
  "websites",
  "welcome",
  "wiki",
  "win",
  "windows",
  "word",
  "work",
  "works",
  "workshop",
  "www",
  "www1",
  "www2",
  "www3",
  "www4",
  "xml",
  "xpg",
  "xxx",
  "yahoo",
  "year",
  "yml",
  "you",
  "yourdomain",
  "yourname",
  "yoursite",
  "yourusername",
]);

/**
 * Check if a username is reserved
 */
export function isReservedUsername(username: string): boolean {
  if (!username) return false;

  const normalized = normalizeUsername(username);
  return RESERVED_USERNAMES.has(normalized);
}

/**
 * Validate username with comprehensive checks
 */
export function validateUsername(username: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!username) {
    errors.push("Username is required");
    return { valid: false, errors };
  }

  // Check basic format
  if (!isValidUsernameForm(username)) {
    errors.push("Username contains invalid characters or format");
  }

  // Check length
  const length = Array.from(username).length; // Unicode-aware length
  if (length < 3) {
    errors.push("Username must be at least 3 characters long");
  }
  if (length > 30) {
    errors.push("Username must be no more than 30 characters long");
  }

  // Check if reserved
  if (isReservedUsername(username)) {
    errors.push("Username is reserved and cannot be used");
  }

  // Check for common patterns that might be problematic
  const normalized = normalizeUsername(username);

  // Check for only numbers
  if (/^\d+$/.test(normalized)) {
    errors.push("Username cannot be only numbers");
  }

  // Check for only special characters
  if (/^[._\-]+$/.test(normalized)) {
    errors.push("Username cannot be only special characters");
  }

  // Check for excessive repetition
  if (/(.)\1{4,}/.test(normalized)) {
    errors.push(
      "Username cannot have more than 4 consecutive identical characters",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate username suggestions based on input
 */
export function generateUsernameSuggestions(
  baseUsername: string,
  existingUsernames: Set<string> = new Set(),
): string[] {
  const suggestions: string[] = [];
  const base = normalizeUsername(baseUsername).replace(/[^a-z0-9]/g, "");

  if (!base) {
    return [];
  }

  // Try the base username first
  if (
    isValidUsernameForm(base) &&
    !isReservedUsername(base) &&
    !existingUsernames.has(base)
  ) {
    suggestions.push(base);
  }

  // Add number suffixes
  for (let i = 1; i <= 999 && suggestions.length < 10; i++) {
    const candidate = `${base}${i}`;
    if (
      isValidUsernameForm(candidate) &&
      !isReservedUsername(candidate) &&
      !existingUsernames.has(candidate)
    ) {
      suggestions.push(candidate);
    }
  }

  // Add common variations
  const variations = [
    `${base}_`,
    `_${base}`,
    `${base}.`,
    `.${base}`,
    `${base}-`,
    `-${base}`,
  ];

  for (const variation of variations) {
    if (suggestions.length >= 10) break;
    if (
      isValidUsernameForm(variation) &&
      !isReservedUsername(variation) &&
      !existingUsernames.has(variation)
    ) {
      suggestions.push(variation);
    }
  }

  return suggestions.slice(0, 10);
}
