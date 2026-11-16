import ProfileView from "./ProfileView";

export default async function Page({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  return <ProfileView walletParam={decodeURIComponent(wallet)} />;
}
