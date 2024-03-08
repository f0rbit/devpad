import { NextResponse } from 'next/server'
import { prisma } from '@/server/db/client';

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const user_id = searchParams.get('user_id');
	const api_key = searchParams.get('api_key');

	if (!user_id) return NextResponse.json({ success: false, data: null, error: "No user specified" });
	if (!api_key) return NextResponse.json({ success: false, data: null, error: "No API Key specified" });

	// check if user exists
	const user = await prisma?.user.findFirst({ where: { id: user_id } });
	if (!user) return NextResponse.json({ success: false, data: null, error: "User not found" });

	// check if api key is valid
	const key = await prisma?.aPIKey.findFirst({ where: { hash: api_key, owner_id: user_id } });
	if (!key) return NextResponse.json({ success: false, data: null, error: "Invalid API Key" });

    // check that we have project_id in the req.query
    const project_id = searchParams.get('project_id');
    if (!project_id) return NextResponse.json({ success: false, data: null, error: "No project specified" });

    // check if project exists
    const project = await prisma?.project.findFirst({ where: { project_id: project_id, owner_id: user_id } });

    if (!project) return NextResponse.json({ success: false, data: null, error: "Project not found" });

    return NextResponse.json({ success: true, data: project, error: null });
}
