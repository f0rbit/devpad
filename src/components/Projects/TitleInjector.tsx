"use client"

export default function TitleInjector({ title} : { title: string}) {
    const element = typeof document != 'undefined' ? document.getElementById("title") : null;
	if (element) element.innerText = title;

    return <></>;
}