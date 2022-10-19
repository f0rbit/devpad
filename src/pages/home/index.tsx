import CenteredContainer from '@/components/CenteredContainer';
import HomeLayout from '@/components/layouts/HomeLayout';
import { NextPage } from 'next';
import HomeNavBar from '@/components/Home/HomeNavBar';

const home: NextPage = () => {
    return (
        <HomeLayout title={'Home Page'}>
            <CenteredContainer>
                <HomeNavBar noicon={false} />
                <div className="h-[200vh]">Home Page -- to implement.</div>
            </CenteredContainer>
        </HomeLayout>
    );
};

export default home;
