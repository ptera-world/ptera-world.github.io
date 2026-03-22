---
label: "why do you have to install things?"
description: "you wanted to resize an image.\nnot adopt a program."
tags: [design, technology]
---

# Why do you have to install things?

Resize an image. Convert a PDF. Record the screen. Simple operations - the kind of thing a computer should obviously be able to do.

But first: find the app. Download it. Run the installer. Click through the dialogs. Maybe create an account. Maybe restart. Now you have a program permanently on your machine that you'll use once and forget about until you notice it's eating disk space six months later.

Nobody wanted a program. They wanted a capability. The program was just [the container it happened to come in](#the-app-as-unit).

## The app as unit

Software used to ship on physical media. A floppy disk, a CD-ROM. The disk was a coherent unit because it had to be - you couldn't ship half a program on half a disk. So the "application" became the atomic thing: one disk, one installer, one entry in the Start menu, one coherent bundle of capabilities.

That physical constraint disappeared decades ago. But the model survived. We still download discrete bundles. We still "install" them - a ceremony that writes files across the system in places you'll never find or fully clean up. We still think of software as a thing you *have*, a noun sitting on your hard drive, rather than something you *do*.

The app boundary was never conceptual. It was logistical. "All the things you might want to do with photos" isn't a natural category - it's a shipping decision. Why does the same program that imports photos also edit them, also organize them, also create slideshows? Because it all fit on the same disk. Because it all belonged to the same company. Because the bundle was the product.

## What normal people do

They google "resize image online."

Web apps are often worse - slower, more limited, ad-plastered. But the distribution model is frictionless. You click a link. The capability exists. You use it. You close the tab.

No installation. No commitment. No leftover files. No uninstaller that doesn't fully uninstall. The web won as a distribution mechanism, not as a platform. Everything had to become a web app to take advantage of that zero-friction entry, whether or not the web was the right runtime for the job.

There's something telling about "resize image online" as a search query. It's someone describing a *capability they want*, not an *app they want*. The intent is pure. The word "app" doesn't appear. "Install" doesn't appear. Just: I have this image, I want it smaller, make that happen.

## What if you could just try?

There's a tool - well, more of a concept - that collapses the gap between "I wonder if this works" and "I'm committed to having this on my machine." On some Linux systems, you can type something like `comma ffmpeg` and it just... runs. No install. [Nothing permanent changes.](/prose/nothing-lasts) The capability materializes, you use it, it's gone.

The technology underneath - Nix, specifically `nix run` - treats programs as ephemeral. You don't "install" them in the traditional sense. You bring them into existence when you need them. The system doesn't accumulate [cruft over time](/prose/what-do-we-keep-losing). There's no registry rot, no leftover DLLs, no AppData folders from programs you forgot you had.

And there's a distinction that this model makes visible: **try** is different from **install**. Right now, for most people, every app is a commitment. Download, install, give it your email, discover it's not what you wanted, uninstall (and hope). The friction of that loop means people just don't explore. They google "best app for X" and pick the first result because experimentation is too expensive.

When trying is free, the whole relationship with software discovery changes. You can evaluate five tools in the time it currently takes to install one. The commitment comes after the experience, not before.

## Why does this feel impossible on most systems?

macOS has Homebrew - good, close to frictionless. But it's still install-first, not try-first. Windows has several competing package managers, none of them the default, half the ecosystem still saying "download the .exe from our website."

And Nix, which gets the model right - ephemeral, reproducible, fully reversible - has a [learning curve that keeps most people out](/prose/why-is-software-hard). The concept is accessible. The implementation assumes you already think in terms of derivations and store paths and flake inputs. The gap between "this is how it should work" and "I can actually use this" is still wide.

The funny thing is that Nix runs everywhere. macOS, any Linux distro, WSL. It's not a platform-specific solution - it's a *model* that happens to travel across platforms. One package manager, same commands, same guarantees, doesn't care what's underneath. That's rare. Most tooling picks a side.

## Underneath the installation problem

The [app isn't the natural unit](/prose/why-is-everything-a-document). The capability is. "Resize this image" doesn't belong to any particular program. Neither does "convert this format" or "play this file" or "find this text." These are operations that exist independently of whatever bundle happens to implement them.

When everything is an app, capabilities get trapped inside containers. The resize function lives inside Photo Editor Pro. The format converter lives inside Media Tool Plus. Each container has its own installation ceremony, its own update cycle, its own way of doing things, its own assumptions about [how you think about the problem](/prose/why-cant-you-just-use-what-exists#what-are-the-assumptions-you-cant-see).

Libraries don't have this problem. A library is a capability - you call the function, you get the result. No installer, no account, no ceremony. The serious infrastructure - ffmpeg, imagemagick, sqlite - has always worked this way. The CLI is a projection of the library, [not the other way around](/prose/why-do-i-build-tools). The capability is the truth. The container is optional.

The question that keeps coming up: if the infrastructure layer already works like this - capabilities as functions, composable, no installation - why does the layer humans actually touch still require the ceremony?

## See also

- [why is everything a document?](/prose/why-is-everything-a-document) - another boundary that was physical, not conceptual
- [why can't you just use what exists?](/prose/why-cant-you-just-use-what-exists) - the assumptions encoded in every tool
- [why is software hard?](/prose/why-is-software-hard) - the paradigm that froze before anyone questioned it
- [why glue?](/prose/why-glue) - the layer between capabilities
