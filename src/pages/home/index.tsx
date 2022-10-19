import CeneteredContainer from '@/components/CenteredContainer';
import HomeLayout from '@/components/layouts/HomeLayout';
import { NextPage } from 'next';

const calendar: NextPage = () => {
    return (
        <HomeLayout title={'Home Page'}>
            <CeneteredContainer>
                <div>Home Page -- to implement.</div>
            </CeneteredContainer>
        </HomeLayout>
    );
};

export default calendar;
